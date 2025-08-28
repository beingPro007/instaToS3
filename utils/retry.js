function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retry with exponential backoff
 * @param {Function} fn - async function to retry
 * @param {Object} options
 * @param {number} options.retries - max retries
 * @param {number} options.baseDelay - base delay in ms
 */
async function retryWithBackoff(fn, { retries = 5, baseDelay = 1000 } = {}) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = baseDelay * Math.pow(2, attempt);
      console.warn(
        `Attempt ${attempt + 1} failed: ${err.message || err}. Retrying in ${wait}ms`
      );
      await delay(wait);
      attempt++;
    }
  }
}

export {retryWithBackoff, delay}