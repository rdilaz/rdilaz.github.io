const transactions = new WeakMap();

export function registerCompletionAccounting(context, handlers = {}) {
  if (!context || typeof context !== 'object') return false;
  if (transactions.has(context)) return false;
  if (typeof handlers.settle !== 'function') return false;
  transactions.set(context, {
    settle: handlers.settle,
    reconcile: typeof handlers.reconcile === 'function' ? handlers.reconcile : null,
    settled: false,
    reconciliationStarted: false,
  });
  return true;
}

export async function settleCompletionAccounting(context, detail = {}) {
  const transaction = context && typeof context === 'object' ? transactions.get(context) : null;
  if (!transaction || transaction.settled) return { settled: false, reason: 'unavailable-or-settled' };
  const result = await transaction.settle(detail);
  if (result?.settled === true || result === true) {
    transaction.settled = true;
    transactions.delete(context);
    return { settled: true, ...(typeof result === 'object' ? result : {}) };
  }
  return { settled: false, ...(typeof result === 'object' ? result : {}) };
}

export function reconcileCompletionAccounting(context, detail = {}) {
  const transaction = context && typeof context === 'object' ? transactions.get(context) : null;
  if (!transaction || transaction.settled || transaction.reconciliationStarted || !transaction.reconcile) {
    return Promise.resolve({ reconciled: false, reason: 'unavailable-or-started' });
  }
  transaction.reconciliationStarted = true;
  return Promise.resolve()
    .then(() => transaction.reconcile(detail))
    .then(result => {
      if (result?.settled === true || result === true) transaction.settled = true;
      return { reconciled: transaction.settled, ...(typeof result === 'object' ? result : {}) };
    })
    .catch(() => ({ reconciled: false, reason: 'lookup-failed' }))
    .finally(() => transactions.delete(context));
}

export function releaseCompletionAccounting(context) {
  if (!context || typeof context !== 'object') return false;
  return transactions.delete(context);
}
