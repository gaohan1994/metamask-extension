import { useCallback, useRef } from 'react';
import { BigNumber } from 'bignumber.js';
import { toHex } from '@metamask/controller-utils';
import type { TransactionMeta } from '@metamask/transaction-controller';
import type { Hex } from '@metamask/utils';
import { commitTransactionPayAmount } from '../../../../store/controller-actions/transaction-pay-controller';
import { useConfirmContext } from '../../context/confirm';
import { getTransactionPayAmountCalls } from '../../utils/transaction-pay-amount';
import {
  beginPayAmountEncode,
  endPayAmountEncode,
} from '../transactions/pay-amount-encode';
import { useTransactionAccountOverride } from '../transactions/useTransactionAccountOverride';
import { useUpdateTokenAmount } from '../transactions/useUpdateTokenAmount';
import { useTransactionPayRequiredTokens } from './useTransactionPayData';

export function useUpdateTransactionPayAmount() {
  const { currentConfirmation: transactionMeta } =
    useConfirmContext<TransactionMeta>();
  const { updateTokenAmount } = useUpdateTokenAmount();
  const requiredTokens = useTransactionPayRequiredTokens();
  const accountOverride = useTransactionAccountOverride();
  const latestAmountRef = useRef<string | undefined>(undefined);

  const decimals = requiredTokens?.[0]?.decimals;

  const updateTransactionPayAmount = useCallback(
    async (amountHuman: string): Promise<boolean> => {
      if (!transactionMeta?.id) {
        return false;
      }

      latestAmountRef.current = amountHuman;

      const callsPromise = getTransactionPayAmountCalls(
        transactionMeta,
        amountHuman,
        accountOverride,
      );

      // A single-call transfer already lands in one transaction state update.
      if (!callsPromise) {
        await updateTokenAmount(amountHuman);
        return true;
      }

      // The previous quote stays executable until this encode is written.
      const generation = beginPayAmountEncode(transactionMeta.id);
      try {
        const calls = await callsPromise;

        // A newer amount superseded this one while its calldata was being built.
        if (latestAmountRef.current !== amountHuman) {
          return false;
        }

        const requiredAssetAmount = getRequiredAssetAmount(
          amountHuman,
          decimals,
        );

        const isRequiredAssetChanged = Boolean(
          requiredAssetAmount &&
          transactionMeta.requiredAssets?.length &&
          transactionMeta.requiredAssets[0].amount !== requiredAssetAmount,
        );

        if (!calls.length && !isRequiredAssetChanged) {
          return false;
        }

        await commitTransactionPayAmount({
          calls,
          requiredAssetAmount,
          transactionId: transactionMeta.id,
        });

        return true;
      } finally {
        endPayAmountEncode(transactionMeta.id, generation);
      }
    },
    [accountOverride, decimals, transactionMeta, updateTokenAmount],
  );

  return {
    updateTransactionPayAmount,
  };
}

function getRequiredAssetAmount(
  amountHuman: string,
  decimals: number | undefined,
): Hex | undefined {
  if (decimals === undefined) {
    return undefined;
  }

  // ROUND_DOWN so Max / near-Max from an 18-decimal pay token never encodes
  // more than the source balance can fund (ROUND_UP was pushing past it).
  const amount = new BigNumber(amountHuman)
    .times(new BigNumber(10).pow(decimals))
    .round(0, BigNumber.ROUND_DOWN);

  if (!amount.isFinite() || amount.isNegative()) {
    return undefined;
  }

  return toHex(amount.toFixed(0)) as Hex;
}
