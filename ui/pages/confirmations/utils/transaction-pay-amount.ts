import {
  TransactionMeta,
  TransactionType,
} from '@metamask/transaction-controller';
import type { Hex } from '@metamask/utils';
import { hasTransactionType } from '../../../../shared/lib/transactions.utils';
import {
  getMoneyAccountDepositAmountCalls,
  getMoneyAccountWithdrawAmountCalls,
  type TransactionPayAmountCall,
} from '../../../store/controller-actions/transaction-pay-controller';

const DEPOSIT_ERROR_PREFIX = 'Money Account Deposit: ';
const WITHDRAW_ERROR_PREFIX = 'Money Account Withdrawal: ';

/**
 * One nested call to apply when a Pay amount changes.
 */
export type UpdateTransactionPayAmountCall = {
  nestedTransactionIndex: number;
  transactionData: Hex;
};

/**
 * Re-encodes the nested calls for transaction types that need bespoke amount
 * handling.
 *
 * This is the single junction where pay amount updates branch on transaction
 * type. Everything else stays generic in `useUpdateTransactionPayAmount`:
 * encoding the required asset amount, committing atomically, and the default
 * single-call token amount update.
 *
 * @param transactionMeta - Confirmation being updated.
 * @param amountHuman - Human-readable amount entered by the user.
 * @param accountOverride - Recipient override when the user picked another account.
 * @returns The calls to apply, or `undefined` when no bespoke handling applies.
 */
export function getTransactionPayAmountCalls(
  transactionMeta: TransactionMeta,
  amountHuman: string,
  accountOverride?: Hex,
): Promise<UpdateTransactionPayAmountCall[]> | undefined {
  if (
    hasTransactionType(transactionMeta, [TransactionType.moneyAccountDeposit])
  ) {
    return getMoneyAccountDepositAmountCalls(transactionMeta.id, amountHuman)
      .then(toUpdateCalls)
      .catch((error: unknown) => {
        throw prefixError(error, DEPOSIT_ERROR_PREFIX);
      });
  }

  if (
    hasTransactionType(transactionMeta, [TransactionType.moneyAccountWithdraw])
  ) {
    return getMoneyAccountWithdrawAmountCalls(
      transactionMeta.id,
      amountHuman,
      accountOverride,
    )
      .then(toUpdateCalls)
      .catch((error: unknown) => {
        throw prefixError(error, WITHDRAW_ERROR_PREFIX);
      });
  }

  return undefined;
}

/**
 * Prefixes an error message. Keeps the original Error so its stack stays.
 *
 * @param error - Thrown value.
 * @param prefix - Text prepended when it is not already present.
 * @returns The prefixed error.
 */
function prefixError(error: unknown, prefix: string): Error {
  if (error instanceof Error) {
    if (!error.message.startsWith(prefix)) {
      error.message = `${prefix}${error.message}`;
    }
    return error;
  }

  return new Error(`${prefix}${String(error)}`);
}

function toUpdateCalls(
  calls: TransactionPayAmountCall[],
): UpdateTransactionPayAmountCall[] {
  return calls.map(({ nestedTransactionIndex, data }) => ({
    nestedTransactionIndex,
    transactionData: data,
  }));
}
