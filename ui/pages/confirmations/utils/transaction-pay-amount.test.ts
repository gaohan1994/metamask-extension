import { TransactionType } from '@metamask/transaction-controller';
import type { TransactionMeta } from '@metamask/transaction-controller';
import type { Hex } from '@metamask/utils';
import {
  getMoneyAccountDepositAmountCalls,
  getMoneyAccountWithdrawAmountCalls,
} from '../../../store/controller-actions/transaction-pay-controller';
import { getTransactionPayAmountCalls } from './transaction-pay-amount';

jest.mock(
  '../../../store/controller-actions/transaction-pay-controller',
  () => ({
    getMoneyAccountDepositAmountCalls: jest.fn(),
    getMoneyAccountWithdrawAmountCalls: jest.fn(),
  }),
);

const TRANSACTION_ID = 'tx-pay-amount';
const OVERRIDE_ADDRESS = '0x1111111111111111111111111111111111111111' as Hex;
const CALLS = [
  { nestedTransactionIndex: 0, data: '0xaaaa' as Hex },
  { nestedTransactionIndex: 1, data: '0xbbbb' as Hex },
];

function createTransaction(type: TransactionType | undefined): TransactionMeta {
  return {
    id: TRANSACTION_ID,
    nestedTransactions: type ? [{ type }] : [],
  } as TransactionMeta;
}

describe('getTransactionPayAmountCalls', () => {
  const getDepositCallsMock = jest.mocked(getMoneyAccountDepositAmountCalls);
  const getWithdrawCallsMock = jest.mocked(getMoneyAccountWithdrawAmountCalls);

  beforeEach(() => {
    jest.resetAllMocks();
    getDepositCallsMock.mockResolvedValue(CALLS);
    getWithdrawCallsMock.mockResolvedValue(CALLS);
  });

  it('returns undefined when the transaction needs no bespoke encoding', () => {
    expect(
      getTransactionPayAmountCalls(
        createTransaction(TransactionType.contractInteraction),
        '1.23',
      ),
    ).toBeUndefined();
    expect(getDepositCallsMock).not.toHaveBeenCalled();
    expect(getWithdrawCallsMock).not.toHaveBeenCalled();
  });

  it('returns deposit calls', async () => {
    const calls = await getTransactionPayAmountCalls(
      createTransaction(TransactionType.moneyAccountDeposit),
      '1.23',
    );

    expect(getDepositCallsMock).toHaveBeenCalledWith(TRANSACTION_ID, '1.23');
    expect(calls).toStrictEqual([
      { nestedTransactionIndex: 0, transactionData: '0xaaaa' },
      { nestedTransactionIndex: 1, transactionData: '0xbbbb' },
    ]);
  });

  it('passes the account override when encoding a withdrawal', async () => {
    await getTransactionPayAmountCalls(
      createTransaction(TransactionType.moneyAccountWithdraw),
      '1.23',
      OVERRIDE_ADDRESS,
    );

    expect(getWithdrawCallsMock).toHaveBeenCalledWith(
      TRANSACTION_ID,
      '1.23',
      OVERRIDE_ADDRESS,
    );
  });

  it('prefixes deposit encoding errors', async () => {
    getDepositCallsMock.mockRejectedValue(new Error('rpc failure'));

    await expect(
      getTransactionPayAmountCalls(
        createTransaction(TransactionType.moneyAccountDeposit),
        '1.23',
      ),
    ).rejects.toThrow('Money Account Deposit: rpc failure');
  });
});
