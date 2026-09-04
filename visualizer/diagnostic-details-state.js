export function createDiagnosticDetailsState() {
  let openId = '';

  return Object.freeze({
    isOpen: id => Boolean(openId && openId === String(id || '')),
    open(id) {
      openId = String(id || '');
      return openId;
    },
    close(id = '') {
      if (!id || openId === String(id)) openId = '';
      return openId;
    },
    select(id) {
      const nextId = String(id || '');
      if (openId && openId !== nextId) openId = '';
      return openId;
    },
    reconcile(ids = []) {
      if (openId && !new Set(ids.map(id => String(id || ''))).has(openId)) openId = '';
      return openId;
    },
    snapshot: () => openId,
  });
}
