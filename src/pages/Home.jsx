import { useState } from 'react';
import DreamField from '../components/DreamField';
import './Home.css';

export default function Home() {
  const [fieldOpen, setFieldOpen] = useState(false);

  return (
    <main className="home-shell">
      <header className="home-intro">
        <h1>Ryo Nagaki-DiLazzaro</h1>
        <p className="home-role">Software Developer</p>
      </header>

      <section className="home-section" aria-labelledby="projects-heading">
        <h3 id="projects-heading">Projects</h3>
        <ul className="projects-list">
          <li>
            <a href="https://mcb.ryo-nd.com" target="_blank" rel="noopener noreferrer">
              Most Common Blunder
            </a>
            {' '}— A chess analysis tool using Stockfish.
          </li>
          <li>
            Spam Shredder — A client-side Chrome extension.{' '}
            (<a href="/SpamShredder/privacy.html">Privacy Policy</a>)
          </li>
        </ul>
      </section>

      <section className="home-section" aria-labelledby="experiments-heading">
        <h3 id="experiments-heading">Experiments</h3>
        <div className="experiment-card">
          <div className="experiment-card__intro">
            <div>
              <span className="experiment-kicker">Interactive experiment 001</span>
              <h4>A Field That Dreams Back</h4>
              <p className="experiment-description">
                A living generative universe written in code—no video or pre-rendered animation.
                Every orbit is created in real time; your pointer becomes gravity, touch becomes a
                shockwave, and rebirth gives the field a new set of initial conditions.
              </p>
            </div>
            <button
              type="button"
              className="experiment-toggle"
              aria-expanded={fieldOpen}
              aria-controls="dream-field-panel"
              onClick={() => setFieldOpen((open) => !open)}
            >
              {fieldOpen ? 'Close the field' : 'Enter the field →'}
            </button>
          </div>

          {fieldOpen && (
            <div className="experiment-panel" id="dream-field-panel">
              <DreamField />
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
