import { useEffect, useRef, useState } from 'react';
import { fetchCanonicalModelInfo } from '../utils/canonical';
import { Session } from '../api';

interface UseCostTrackingProps {
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionCacheReadInputTokens: number;
  sessionCacheWriteInputTokens: number;
  localInputTokens: number;
  localOutputTokens: number;
  localCacheReadInputTokens: number;
  localCacheWriteInputTokens: number;
  session?: Session | null;
}

const calculateTrackedCost = (
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens: number,
  cacheWriteInputTokens: number,
  costInfo: {
    input_token_cost?: number | null;
    output_token_cost?: number | null;
    cache_read_token_cost?: number | null;
    cache_write_token_cost?: number | null;
  }
) => {
  const billableInputTokens = Math.max(
    inputTokens - cacheReadInputTokens - cacheWriteInputTokens,
    0
  );

  const inputCost = (billableInputTokens * (costInfo.input_token_cost || 0)) / 1_000_000;
  const outputCost = (outputTokens * (costInfo.output_token_cost || 0)) / 1_000_000;
  const cacheReadCost = (cacheReadInputTokens * (costInfo.cache_read_token_cost || 0)) / 1_000_000;
  const cacheWriteCost =
    (cacheWriteInputTokens * (costInfo.cache_write_token_cost || 0)) / 1_000_000;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
};

export const useCostTracking = ({
  sessionInputTokens,
  sessionOutputTokens,
  sessionCacheReadInputTokens,
  sessionCacheWriteInputTokens,
  localInputTokens,
  localOutputTokens,
  localCacheReadInputTokens,
  localCacheWriteInputTokens,
  session,
}: UseCostTrackingProps) => {
  const [sessionCosts, setSessionCosts] = useState<{
    [key: string]: {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheWriteInputTokens: number;
      totalCost: number;
    };
  }>({});

  const currentModel =
    session?.resolved_model_name ?? session?.model_config?.model_name ?? undefined;
  const currentProvider = session?.provider_name ?? undefined;
  const prevModelRef = useRef<string | undefined>(undefined);
  const prevProviderRef = useRef<string | undefined>(undefined);

  // Handle model changes and accumulate costs
  useEffect(() => {
    if (!currentModel || !currentProvider) return;

    const handleModelChange = async () => {
      if (
        prevModelRef.current !== undefined &&
        prevProviderRef.current !== undefined &&
        (prevModelRef.current !== currentModel || prevProviderRef.current !== currentProvider)
      ) {
        // Model/provider has changed, save the costs for the previous model
        const prevKey = `${prevProviderRef.current}/${prevModelRef.current}`;

        // Get pricing info for the previous model
        const prevCostInfo = await fetchCanonicalModelInfo(
          prevProviderRef.current,
          prevModelRef.current
        );

        if (prevCostInfo) {
          const inputTokens = sessionInputTokens || localInputTokens;
          const outputTokens = sessionOutputTokens || localOutputTokens;
          const cacheReadInputTokens = sessionCacheReadInputTokens || localCacheReadInputTokens;
          const cacheWriteInputTokens = sessionCacheWriteInputTokens || localCacheWriteInputTokens;
          const prevTotalCost = calculateTrackedCost(
            inputTokens,
            outputTokens,
            cacheReadInputTokens,
            cacheWriteInputTokens,
            prevCostInfo
          );

          // Save the accumulated costs for this model
          setSessionCosts((prev) => ({
            ...prev,
            [prevKey]: {
              inputTokens,
              outputTokens,
              cacheReadInputTokens,
              cacheWriteInputTokens,
              totalCost: prevTotalCost,
            },
          }));
        }

        console.log(
          'Model changed from',
          `${prevProviderRef.current}/${prevModelRef.current}`,
          'to',
          `${currentProvider}/${currentModel}`,
          '- saved costs and restored session token counters'
        );
      }

      prevModelRef.current = currentModel || undefined;
      prevProviderRef.current = currentProvider || undefined;
    };

    handleModelChange();
  }, [
    currentModel,
    currentProvider,
    sessionInputTokens,
    sessionOutputTokens,
    sessionCacheReadInputTokens,
    sessionCacheWriteInputTokens,
    localInputTokens,
    localOutputTokens,
    localCacheReadInputTokens,
    localCacheWriteInputTokens,
    session,
  ]);

  return {
    sessionCosts,
  };
};
