import { useState, useEffect } from 'react';
import { CoinIcon } from '../icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip';
import { fetchCanonicalModelInfo } from '../../utils/canonical';
import type { ModelInfoData } from '../../api';

interface CostTrackerProps {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  sessionCosts?: {
    [key: string]: {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheWriteInputTokens: number;
      totalCost: number;
    };
  };
  model: string | null;
  provider: string | null;
}

const hasPricingInfo = (costInfo: ModelInfoData | null) =>
  !!costInfo &&
  [
    costInfo.input_token_cost,
    costInfo.output_token_cost,
    costInfo.cache_read_token_cost,
    costInfo.cache_write_token_cost,
  ].some((value) => value !== undefined && value !== null);

const getBillableInputTokens = (
  inputTokens: number,
  cacheReadInputTokens: number,
  cacheWriteInputTokens: number
) => Math.max(inputTokens - cacheReadInputTokens - cacheWriteInputTokens, 0);

const calculateTrackedCost = (
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens: number,
  cacheWriteInputTokens: number,
  costInfo: ModelInfoData
) => {
  const billableInputTokens = getBillableInputTokens(
    inputTokens,
    cacheReadInputTokens,
    cacheWriteInputTokens
  );
  const inputCost = (billableInputTokens * (costInfo.input_token_cost || 0)) / 1_000_000;
  const outputCost = (outputTokens * (costInfo.output_token_cost || 0)) / 1_000_000;
  const cacheReadCost = (cacheReadInputTokens * (costInfo.cache_read_token_cost || 0)) / 1_000_000;
  const cacheWriteCost =
    (cacheWriteInputTokens * (costInfo.cache_write_token_cost || 0)) / 1_000_000;

  return {
    billableInputTokens,
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
};

const formatTokenBreakdown = (
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens: number,
  cacheWriteInputTokens: number
) => {
  const parts = [
    `${getBillableInputTokens(inputTokens, cacheReadInputTokens, cacheWriteInputTokens).toLocaleString()} input`,
  ];

  if (cacheReadInputTokens > 0) {
    parts.push(`${cacheReadInputTokens.toLocaleString()} cache read`);
  }

  if (cacheWriteInputTokens > 0) {
    parts.push(`${cacheWriteInputTokens.toLocaleString()} cache write`);
  }

  parts.push(`${outputTokens.toLocaleString()} output`);

  return parts.join(', ');
};

export function CostTracker({
  inputTokens = 0,
  outputTokens = 0,
  cacheReadInputTokens = 0,
  cacheWriteInputTokens = 0,
  sessionCosts,
  model: currentModel,
  provider: currentProvider,
}: CostTrackerProps) {
  const [costInfo, setCostInfo] = useState<ModelInfoData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showPricing, setShowPricing] = useState(true);
  const [pricingFailed, setPricingFailed] = useState(false);

  // Check if pricing is enabled
  useEffect(() => {
    const loadPricingSetting = async () => {
      const enabled = await window.electron.getSetting('showPricing');
      setShowPricing(enabled);
    };

    loadPricingSetting();

    const handlePricingChange = () => {
      loadPricingSetting();
    };

    window.addEventListener('showPricingChanged', handlePricingChange);
    return () => window.removeEventListener('showPricingChanged', handlePricingChange);
  }, []);

  useEffect(() => {
    const loadCostInfo = async () => {
      if (!currentModel || !currentProvider) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const costData = await fetchCanonicalModelInfo(currentProvider, currentModel);
        if (costData) {
          setCostInfo(costData);
          setPricingFailed(false);
        } else {
          setPricingFailed(true);
          setCostInfo(null);
        }
      } catch {
        setPricingFailed(true);
        setCostInfo(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadCostInfo();
  }, [currentModel, currentProvider]);

  // Return null early if pricing is disabled
  if (!showPricing) {
    return null;
  }

  const calculateCost = (): number => {
    // If we have session costs, calculate the total across all models
    if (sessionCosts) {
      let totalCost = 0;

      // Add up all historical costs from different models
      Object.values(sessionCosts).forEach((modelCost) => {
        totalCost += modelCost.totalCost;
      });

      // Add current model cost if we have pricing info
      if (costInfo && hasPricingInfo(costInfo)) {
        totalCost += calculateTrackedCost(
          inputTokens,
          outputTokens,
          cacheReadInputTokens,
          cacheWriteInputTokens,
          costInfo
        ).totalCost;
      }

      return totalCost;
    }

    // Fallback to simple calculation for current model only
    if (!costInfo || !hasPricingInfo(costInfo)) {
      return 0;
    }

    return calculateTrackedCost(
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheWriteInputTokens,
      costInfo
    ).totalCost;
  };

  const formatCost = (cost: number): string => {
    // Always show 4 decimal places for consistency
    return cost.toFixed(4);
  };

  // Show loading state or when we don't have model/provider info
  if (!currentModel || !currentProvider) {
    return null;
  }

  // If still loading, show a placeholder
  if (isLoading) {
    return (
      <>
        <div className="flex items-center justify-center h-full text-text-secondary translate-y-[1px]">
          <span className="text-xs font-mono">...</span>
        </div>
        <div className="w-px h-4 bg-border-primary mx-2" />
      </>
    );
  }

  // If no cost info found, try to return a default
  if (!costInfo || !hasPricingInfo(costInfo)) {
    const freeProviders = ['ollama', 'local', 'localhost'];
    if (freeProviders.includes(currentProvider.toLowerCase())) {
      return (
        <>
          <div className="flex items-center justify-center h-full text-text-primary/70 transition-colors cursor-default translate-y-[1px]">
            <span className="text-xs font-mono">
              {formatTokenBreakdown(
                inputTokens,
                outputTokens,
                cacheReadInputTokens,
                cacheWriteInputTokens
              )}
            </span>
          </div>
          <div className="w-px h-4 bg-border-primary mx-2" />
        </>
      );
    }

    // Otherwise show as unavailable
    const getUnavailableTooltip = () => {
      if (pricingFailed) {
        return `Pricing data unavailable for ${currentModel}`;
      }
      return `Cost data not available for ${currentModel} (${formatTokenBreakdown(
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheWriteInputTokens
      )} tokens)`;
    };

    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center justify-center h-full transition-colors cursor-default translate-y-[1px] text-text-primary/70 hover:text-text-primary">
              <CoinIcon className="mr-1" size={16} />
              <span className="text-xs font-mono">0.0000</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>{getUnavailableTooltip()}</TooltipContent>
        </Tooltip>
        <div className="w-px h-4 bg-border-primary mx-2" />
      </>
    );
  }

  const totalCost = calculateCost();
  const currentCostBreakdown = calculateTrackedCost(
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheWriteInputTokens,
    costInfo
  );

  // Build tooltip content
  const getTooltipContent = (): string => {
    // Handle error states first
    if (pricingFailed) {
      return `Pricing data unavailable for ${currentProvider}/${currentModel}`;
    }

    // Handle session costs
    if (sessionCosts && Object.keys(sessionCosts).length > 0) {
      // Show session breakdown
      let tooltip = 'Session cost breakdown:\n';

      Object.entries(sessionCosts).forEach(([modelKey, cost]) => {
        const costStr = `${costInfo?.currency || '$'}${cost.totalCost.toFixed(6)}`;
        tooltip += `${modelKey}: ${costStr} (${formatTokenBreakdown(cost.inputTokens, cost.outputTokens, cost.cacheReadInputTokens, cost.cacheWriteInputTokens)})\n`;
      });

      // Add current model if it has costs
      if (costInfo && (inputTokens > 0 || outputTokens > 0)) {
        const currentCost = currentCostBreakdown.totalCost;
        if (currentCost > 0) {
          tooltip += `${currentProvider}/${currentModel} (current): ${costInfo.currency || '$'}${currentCost.toFixed(6)} (${formatTokenBreakdown(inputTokens, outputTokens, cacheReadInputTokens, cacheWriteInputTokens)})\n`;
        }
      }

      tooltip += `\nTotal session cost: ${costInfo?.currency || '$'}${totalCost.toFixed(6)}`;
      return tooltip;
    }

    // Default tooltip for single model
    const lines = [
      `Input: ${currentCostBreakdown.billableInputTokens.toLocaleString()} tokens (${costInfo?.currency || '$'}${currentCostBreakdown.inputCost.toFixed(6)})`,
    ];

    if (cacheReadInputTokens > 0) {
      lines.push(
        `Cache read: ${cacheReadInputTokens.toLocaleString()} tokens (${costInfo?.currency || '$'}${currentCostBreakdown.cacheReadCost.toFixed(6)})`
      );
    }

    if (cacheWriteInputTokens > 0) {
      lines.push(
        `Cache write: ${cacheWriteInputTokens.toLocaleString()} tokens (${costInfo?.currency || '$'}${currentCostBreakdown.cacheWriteCost.toFixed(6)})`
      );
    }

    lines.push(
      `Output: ${outputTokens.toLocaleString()} tokens (${costInfo?.currency || '$'}${currentCostBreakdown.outputCost.toFixed(6)})`
    );

    lines.push(`Total: ${costInfo?.currency || '$'}${currentCostBreakdown.totalCost.toFixed(6)}`);

    return lines.join('\n');
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center justify-center h-full transition-colors cursor-default translate-y-[1px] text-text-primary/70 hover:text-text-primary">
            <CoinIcon className="mr-1" size={16} />
            <span className="text-xs font-mono">{formatCost(totalCost)}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>{getTooltipContent()}</TooltipContent>
      </Tooltip>
      <div className="w-px h-4 bg-border-primary mx-2" />
    </>
  );
}
