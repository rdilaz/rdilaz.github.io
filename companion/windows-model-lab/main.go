package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	host          = "127.0.0.1"
	port          = "4096"
	allowedOrigin = "https://ryo-nd.com"
	visualizerURL = "https://ryo-nd.com/visualizer/"
)

var (
	opencodePath string
	workdir      string
	modelLineRE  = regexp.MustCompile(`^[^\s/]+/.+`)
	sessions     = map[string]*session{}
	sessionsMu   sync.Mutex
	modelsMu     sync.Mutex
	modelsCache  any
	modelsAt     time.Time
)

type session struct {
	cancel context.CancelFunc
}

type provider struct {
	ID     string         `json:"id"`
	Name   string         `json:"name"`
	Models map[string]any `json:"models"`
}

func main() {
	if alreadyRunning() {
		messageBox("AI Visualizer Model Lab", "Model Lab is already running. Return to the Visualizer and press Connect.")
		openBrowser(visualizerURL)
		return
	}

	var err error
	opencodePath, err = findOpenCode()
	if err != nil {
		messageBox("AI Visualizer Model Lab", "OpenCode is not installed on this computer yet. Install/connect OpenCode first, then open this companion again.")
		openBrowser(visualizerURL + "?modelLab=opencode-missing")
		return
	}

	workdir, err = os.MkdirTemp("", "ai-visualizer-opencode-")
	if err != nil {
		fatalBox(err)
		return
	}
	defer os.RemoveAll(workdir)
	config := []byte("{\n  \"$schema\": \"https://opencode.ai/config.json\",\n  \"permission\": \"deny\"\n}\n")
	if err := os.WriteFile(filepath.Join(workdir, "opencode.json"), config, 0600); err != nil {
		fatalBox(err)
		return
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/global/health", healthHandler)
	mux.HandleFunc("/provider", providerHandler)
	mux.HandleFunc("/session", sessionHandler)
	mux.HandleFunc("/session/", sessionRouteHandler)
	mux.HandleFunc("/shutdown", shutdownHandler)

	server := &http.Server{
		Addr:              net.JoinHostPort(host, port),
		Handler:           cors(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		if alreadyRunning() {
			messageBox("AI Visualizer Model Lab", "Model Lab is already running. Return to the Visualizer and press Connect.")
			openBrowser(visualizerURL)
			return
		}
		messageBox("AI Visualizer Model Lab", "Could not start the companion because local port 4096 is being used by another app. Restart Windows or close the app using that port, then open Model Lab again.")
		return
	}

	go func() {
		_ = server.Serve(listener)
	}()

	openBrowser(visualizerURL + "?modelLab=ready")
	messageBox("AI Visualizer Model Lab", "Connected. ChatGPT/OpenCode subscription models are now available to the Visualizer.\n\nYou can close this message; Model Lab will keep running quietly in the background.")

	select {}
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && origin != allowedOrigin {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin not allowed"})
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Private-Network", "true")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Vary", "Origin")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	stdout, _, err := runOpenCode(ctx, []string{"--version"}, "")
	version := strings.TrimSpace(stdout)
	if err != nil {
		version = ""
	}
	writeJSON(w, http.StatusOK, map[string]any{"healthy": true, "version": version, "bridge": "windows-companion-v1"})
}

func providerHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	payload, err := providerPayload(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func sessionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	id := fmt.Sprintf("viz_%d", time.Now().UnixNano())
	sessionsMu.Lock()
	sessions[id] = &session{}
	sessionsMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func sessionRouteHandler(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/session/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 1 && r.Method == http.MethodDelete {
		deleteSession(parts[0])
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
		return
	}
	if len(parts) != 2 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
		return
	}
	id, action := parts[0], parts[1]
	if action == "abort" && r.Method == http.MethodPost {
		aborted := cancelSession(id)
		writeJSON(w, http.StatusOK, map[string]any{"aborted": aborted})
		return
	}
	if action != "message" || r.Method != http.MethodPost {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
		return
	}
	var body map[string]any
	if err := decodeBody(r.Body, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	result, err := runModel(r.Context(), id, body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func shutdownHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stopping": true})
	go func() {
		time.Sleep(150 * time.Millisecond)
		os.Exit(0)
	}()
}

func providerPayload(parent context.Context) (any, error) {
	modelsMu.Lock()
	if modelsCache != nil && time.Since(modelsAt) < 30*time.Second {
		cached := modelsCache
		modelsMu.Unlock()
		return cached, nil
	}
	modelsMu.Unlock()

	ctx, cancel := context.WithTimeout(parent, 90*time.Second)
	defer cancel()
	stdout, stderr, err := runOpenCode(ctx, []string{"models", "--verbose"}, "")
	if err != nil {
		return nil, errors.New(firstNonEmpty(stderr, stdout, err.Error()))
	}
	providers := parseVerboseModels(stdout)
	connected := make([]string, 0, len(providers))
	for _, p := range providers {
		connected = append(connected, p.ID)
	}
	payload := map[string]any{"all": providers, "connected": connected}
	modelsMu.Lock()
	modelsCache, modelsAt = payload, time.Now()
	modelsMu.Unlock()
	return payload, nil
}

func parseVerboseModels(output string) []provider {
	lines := strings.Split(strings.ReplaceAll(output, "\r", ""), "\n")
	byProvider := map[string]*provider{}
	order := []string{}
	for i := 0; i < len(lines); {
		idLine := strings.TrimSpace(lines[i])
		if !modelLineRE.MatchString(idLine) {
			i++
			continue
		}
		slash := strings.Index(idLine, "/")
		providerID, modelID := idLine[:slash], idLine[slash+1:]
		i++
		for i < len(lines) && strings.TrimSpace(lines[i]) == "" {
			i++
		}
		model := map[string]any{"id": modelID, "name": modelID}
		if i < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[i]), "{") {
			block, next := collectJSON(lines, i)
			i = next
			var parsed map[string]any
			if json.Unmarshal([]byte(block), &parsed) == nil {
				model = parsed
				model["id"] = modelID
				if _, ok := model["name"]; !ok {
					model["name"] = modelID
				}
			}
		}
		p := byProvider[providerID]
		if p == nil {
			p = &provider{ID: providerID, Name: providerName(providerID), Models: map[string]any{}}
			byProvider[providerID] = p
			order = append(order, providerID)
		}
		p.Models[modelID] = model
	}
	result := make([]provider, 0, len(order))
	seen := map[string]bool{}
	for _, id := range order {
		if !seen[id] {
			seen[id] = true
			result = append(result, *byProvider[id])
		}
	}
	return result
}

func collectJSON(lines []string, start int) (string, int) {
	var b strings.Builder
	depth := 0
	inString := false
	escaped := false
	started := false
	for i := start; i < len(lines); i++ {
		line := lines[i]
		b.WriteString(line)
		b.WriteByte('\n')
		for _, ch := range line {
			if escaped {
				escaped = false
				continue
			}
			if inString && ch == '\\' {
				escaped = true
				continue
			}
			if ch == '"' {
				inString = !inString
				continue
			}
			if inString {
				continue
			}
			if ch == '{' {
				depth++
				started = true
			}
			if ch == '}' {
				depth--
			}
		}
		if started && depth == 0 {
			return b.String(), i + 1
		}
	}
	return b.String(), len(lines)
}

func runModel(parent context.Context, id string, body map[string]any) (any, error) {
	sessionsMu.Lock()
	s := sessions[id]
	sessionsMu.Unlock()
	if s == nil {
		return nil, errors.New("unknown Model Lab session")
	}

	model, _ := body["model"].(map[string]any)
	providerID := stringValue(model["providerID"])
	modelID := stringValue(model["modelID"])
	variant := stringValue(body["variant"])
	if providerID == "" || modelID == "" {
		return nil, errors.New("missing OpenCode model identity")
	}

	prompt := buildPrompt(body)
	if strings.TrimSpace(prompt) == "" {
		return nil, errors.New("visualizer prompt was empty")
	}

	ctx, cancel := context.WithCancel(parent)
	sessionsMu.Lock()
	s.cancel = cancel
	sessionsMu.Unlock()
	defer func() {
		cancel()
		sessionsMu.Lock()
		if current := sessions[id]; current != nil {
			current.cancel = nil
		}
		sessionsMu.Unlock()
	}()

	args := []string{"run", "--format", "json", "--model", providerID + "/" + modelID, "--dir", workdir}
	if variant != "" {
		args = append(args, "--variant", variant)
	}
	stdout, stderr, err := runOpenCode(ctx, args, prompt)
	if err != nil {
		return nil, errors.New(firstNonEmpty(stderr, stdout, err.Error()))
	}
	text, tokens, cost, resolved, err := parseRunOutput(stdout)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"info": map[string]any{
			"tokens": tokens,
			"cost":   cost,
			"model":  firstNonEmpty(resolved, providerID+"/"+modelID),
		},
		"parts": []any{map[string]any{"type": "text", "text": text}},
	}, nil
}

func buildPrompt(body map[string]any) string {
	sections := []string{}
	if system := stringValue(body["system"]); system != "" {
		sections = append(sections, system)
	}
	if parts, ok := body["parts"].([]any); ok {
		for _, raw := range parts {
			part, _ := raw.(map[string]any)
			if stringValue(part["type"]) == "text" {
				if text := stringValue(part["text"]); text != "" {
					sections = append(sections, text)
				}
			}
		}
	}
	return strings.Join(sections, "\n\n")
}

func parseRunOutput(output string) (string, map[string]any, float64, string, error) {
	texts := []string{}
	tokens := map[string]any{"input": 0, "output": 0, "reasoning": 0}
	var cost float64
	var resolved string
	var reportedErr string
	scanner := bufio.NewScanner(strings.NewReader(output))
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var event map[string]any
		if json.Unmarshal([]byte(line), &event) != nil {
			continue
		}
		typ := stringValue(event["type"])
		part, _ := event["part"].(map[string]any)
		if typ == "text" && !boolValue(part["synthetic"]) && !boolValue(part["ignored"]) {
			if text := stringValue(part["text"]); text != "" {
				texts = append(texts, text)
			}
		}
		if typ == "step_finish" || typ == "step-finish" {
			if t, ok := part["tokens"].(map[string]any); ok {
				tokens = t
			}
			cost = floatValue(part["cost"])
			resolved = stringValue(part["model"])
		}
		if typ == "error" {
			reportedErr = firstNonEmpty(stringValue(part["message"]), reportedErr)
		}
	}
	text := strings.Join(texts, "")
	if strings.TrimSpace(text) == "" {
		return "", tokens, cost, resolved, errors.New(firstNonEmpty(reportedErr, "OpenCode returned no visualizer text"))
	}
	return text, tokens, cost, resolved, nil
}

func runOpenCode(ctx context.Context, args []string, input string) (string, string, error) {
	cmd := openCodeCommand(ctx, args...)
	cmd.Dir = workdir
	cmd.Stdin = strings.NewReader(input)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return "", "", err
	}
	done := make(chan struct{})
	go func(pid int) {
		select {
		case <-ctx.Done():
			_ = exec.Command("taskkill.exe", "/PID", fmt.Sprint(pid), "/T", "/F").Run()
		case <-done:
		}
	}(cmd.Process.Pid)
	err := cmd.Wait()
	close(done)
	return stdout.String(), stderr.String(), err
}

func openCodeCommand(ctx context.Context, args ...string) *exec.Cmd {
	if strings.HasSuffix(strings.ToLower(opencodePath), ".cmd") {
		quoted := []string{quoteWindows(opencodePath)}
		for _, arg := range args {
			quoted = append(quoted, quoteWindows(arg))
		}
		return exec.CommandContext(ctx, "cmd.exe", "/d", "/s", "/c", strings.Join(quoted, " "))
	}
	return exec.CommandContext(ctx, opencodePath, args...)
}

func findOpenCode() (string, error) {
	candidates := []string{}
	if appdata := os.Getenv("APPDATA"); appdata != "" {
		candidates = append(candidates,
			filepath.Join(appdata, "npm", "node_modules", "opencode-ai", "bin", "opencode.exe"),
			filepath.Join(appdata, "npm", "opencode.cmd"),
		)
	}
	for _, name := range []string{"opencode.exe", "opencode.cmd"} {
		if p, err := exec.LookPath(name); err == nil {
			candidates = append(candidates, p)
		}
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", errors.New("OpenCode executable not found")
}

func cancelSession(id string) bool {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	s := sessions[id]
	if s == nil || s.cancel == nil {
		return false
	}
	s.cancel()
	return true
}

func deleteSession(id string) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	if s := sessions[id]; s != nil && s.cancel != nil {
		s.cancel()
	}
	delete(sessions, id)
}

func alreadyRunning() bool {
	client := &http.Client{Timeout: 650 * time.Millisecond}
	resp, err := client.Get("http://127.0.0.1:4096/global/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var payload map[string]any
	if json.NewDecoder(io.LimitReader(resp.Body, 128*1024)).Decode(&payload) != nil {
		return false
	}
	return boolValue(payload["healthy"])
}

func decodeBody(r io.Reader, target any) error {
	return json.NewDecoder(io.LimitReader(r, 2*1024*1024)).Decode(target)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func providerName(id string) string {
	switch {
	case id == "openai":
		return "ChatGPT / OpenAI"
	case id == "opencode" || strings.HasPrefix(id, "opencode-"):
		return "OpenCode Go / Zen"
	case id == "anthropic":
		return "Anthropic"
	case id == "google":
		return "Google"
	default:
		return id
	}
}

func quoteWindows(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func stringValue(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func boolValue(v any) bool {
	b, _ := v.(bool)
	return b
}

func floatValue(v any) float64 {
	if n, ok := v.(float64); ok {
		return n
	}
	return 0
}

func openBrowser(url string) {
	_ = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
}

func messageBox(title, text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("MessageBoxW")
	titlePtr, _ := syscall.UTF16PtrFromString(title)
	textPtr, _ := syscall.UTF16PtrFromString(text)
	_, _, _ = proc.Call(0, uintptr(unsafe.Pointer(textPtr)), uintptr(unsafe.Pointer(titlePtr)), uintptr(0x40))
}

func fatalBox(err error) {
	messageBox("AI Visualizer Model Lab", "Could not start Model Lab:\n\n"+err.Error())
}
