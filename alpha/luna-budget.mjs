/** Conservative pre-request reservation. This is not a replacement for gateway billing limits. */
export function createLunaBudget({maxRequests = 3, maxUsd = 0.25, inputRate, outputRate} = {}) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 5
    || !Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 0.25
    || !Number.isFinite(inputRate) || inputRate < 0 || !Number.isFinite(outputRate) || outputRate <= 0) throw Error('BUDGET_CONFIG_REQUIRED');
  let attempted = 0, reservedUsd = 0, observedUsd = 0, usageReports = 0;
  const receipts = [];
  return {
    ready: true,
    options: {
      maxRequests: Math.min(maxRequests, 3),
      beforeInference(body) {
        if (attempted >= maxRequests) throw Error('REQUEST_BUDGET_EXHAUSTED');
        const bytes = Buffer.byteLength(JSON.stringify(body));
        if (bytes > 32768) throw Error('INPUT_BUDGET_EXHAUSTED');
        // Byte-based token ceiling + protocol padding, valued at operator-supplied maximum rates.
        // No cache discounts assumed. Unknown gateway billing can only be capped at the gateway.
        const reserve = ((bytes + 4096) * inputRate + body.max_output_tokens * outputRate) / 1e6;
        if (reservedUsd + reserve > maxUsd) throw Error('USD_RESERVATION_EXHAUSTED');
        reservedUsd += reserve; attempted++;
        receipts.push({request: attempted, reservedUsd: reserve});
      },
      afterInference(entry) {
        const usage = entry.usage;
        if (Number.isSafeInteger(usage?.input_tokens) && Number.isSafeInteger(usage?.output_tokens)) {
          observedUsd += (usage.input_tokens * inputRate + usage.output_tokens * outputRate) / 1e6;
          usageReports++;
          if (observedUsd > maxUsd) throw Error('REPORTED_COST_EXCEEDS_BUDGET');
        }
      },
    },
    report() {
      return {maxRequests, attempted, maxUsd, reservedUsd, usageReports,
        observedUsagePriceEstimateUsd: usageReports ? observedUsd : null,
        unreportedUsageRequests: attempted - usageReports, inputUsdPerMillion: inputRate,
        outputUsdPerMillion: outputRate, billingHardLimit: false,
        rateSource: 'operator configured maximum rates; verify at gateway', reservations: receipts};
    },
  };
}

/** Live runs must be explicitly opted in with rates; credentials alone never authorize spending. */
export function liveBudgetFromEnv(env, maxRequests = 3) {
  const notReady = reason => ({ready: false, reason, options: {}, report: () => ({ready: false, reason, attempted: 0, billingHardLimit: false})});
  if (env.ALPHA_SMOKE_ALLOW_LIVE !== '1') return notReady('LIVE_OPT_IN_REQUIRED');
  if (!env.ALPHA_SMOKE_INPUT_USD_PER_MILLION || !env.ALPHA_SMOKE_OUTPUT_USD_PER_MILLION) return notReady('GATEWAY_RATES_REQUIRED');
  try {
    return createLunaBudget({maxRequests, maxUsd: Number(env.ALPHA_SMOKE_MAX_USD ?? '0.25'),
      inputRate: Number(env.ALPHA_SMOKE_INPUT_USD_PER_MILLION), outputRate: Number(env.ALPHA_SMOKE_OUTPUT_USD_PER_MILLION)});
  } catch { return notReady('BUDGET_CONFIG_INVALID'); }
}
