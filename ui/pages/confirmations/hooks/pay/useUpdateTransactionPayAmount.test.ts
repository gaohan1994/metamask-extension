import type { TransactionMeta } from '@metamask/transaction-controller';
import type { TransactionPayRequiredToken } from '@metamask/transaction-pay-controller';
import type { Hex } from '@metamask/utils';
import { act } from '@testing-library/react';
import { genUnapprovedContractInteractionConfirmation } from '../../../../../test/data/confirmations/contract-interaction';
import { getMockConfirmStateForTransaction } from '../../../../../test/data/confirmations/helper';
import { renderHookWithConfirmContextProvider } from '../../../../../test/lib/confirmations/render-helpers';
import { commitTransactionPayAmount } from '../../../../store/controller-actions/transaction-pay-controller';
import { getTransactionPayAmountCalls } from '../../utils/transaction-pay-amount';
import {
  isPayAmountEncodePending,
  resetPayAmountEncodes,
} from '../transactions/pay-amount-encode';
import { useTransactionAccountOverride } from '../transactions/useTransactionAccountOverride';
import { useUpdateTokenAmount } from '../transactions/useUpdateTokenAmount';
import { useTransactionPayRequiredTokens } from './useTransactionPayData';
import { useUpdateTransactionPayAmount } from './useUpdateTransactionPayAmount';

jest.mock(
  '../../../../store/controller-actions/transaction-pay-controller',
  () => ({
    commitTransactionPayAmount: jest.fn(),
  }),
);
jest.mock('../../utils/transaction-pay-amount', () => ({
  getTransactionPayAmountCalls: jest.fn(),
}));
jest.mock('../transactions/useTransactionAccountOverride');
jest.mock('../transactions/useUpdateTokenAmount');
jest.mock('./useTransactionPayData', () => ({
  useTransactionPayRequiredTokens: jest.fn(),
}));

const AMOUNT = '1.23';
const OVERRIDE_ADDRESS = '0x1111111111111111111111111111111111111111' as Hex;
const CALLS = [
  { nestedTransactionIndex: 0, transactionData: '0xaaaa' as Hex },
  { nestedTransactionIndex: 1, transactionData: '0xbbbb' as Hex },
];

function createTransaction(
  overrides: Partial<TransactionMeta> = {},
): TransactionMeta {
  return {
    ...genUnapprovedContractInteractionConfirmation(),
    requiredAssets: [
      {
        address: '0x3333333333333333333333333333333333333333',
        amount: '0x0',
        standard: 'erc20',
      },
    ],
    ...overrides,
  } as TransactionMeta;
}

function runHook(transactionMeta: TransactionMeta = createTransaction()) {
  return renderHookWithConfirmContextProvider(
    useUpdateTransactionPayAmount,
    getMockConfirmStateForTransaction(transactionMeta),
  );
}

describe('useUpdateTransactionPayAmount', () => {
  const commitMock = jest.mocked(commitTransactionPayAmount);
  const getCallsMock = jest.mocked(getTransactionPayAmountCalls);
  const updateTokenAmountMock = jest.fn();

  beforeEach(() => {
    resetPayAmountEncodes();
    jest.resetAllMocks();
    getCallsMock.mockResolvedValue(CALLS);
    commitMock.mockResolvedValue(true);
    updateTokenAmountMock.mockResolvedValue(undefined);
    jest.mocked(useUpdateTokenAmount).mockReturnValue({
      updateTokenAmount: updateTokenAmountMock,
      isUpdating: false,
    });
    jest.mocked(useTransactionAccountOverride).mockReturnValue(undefined);
    jest
      .mocked(useTransactionPayRequiredTokens)
      .mockReturnValue([{ decimals: 6 } as TransactionPayRequiredToken]);
  });

  it('falls back to the token amount update when there are no external calls', async () => {
    getCallsMock.mockReturnValue(undefined);

    const { result } = runHook();
    await act(async () => {
      await result.current.updateTransactionPayAmount(AMOUNT);
    });

    expect(updateTokenAmountMock).toHaveBeenCalledWith(AMOUNT);
    expect(commitMock).not.toHaveBeenCalled();
  });

  it('passes the account override to the external module', async () => {
    jest
      .mocked(useTransactionAccountOverride)
      .mockReturnValue(OVERRIDE_ADDRESS);
    const transactionMeta = createTransaction();

    const { result } = runHook(transactionMeta);
    await act(async () => {
      await result.current.updateTransactionPayAmount(AMOUNT);
    });

    expect(getCallsMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: transactionMeta.id }),
      AMOUNT,
      OVERRIDE_ADDRESS,
    );
  });

  it('commits calldata and the required asset amount in one update', async () => {
    const transactionMeta = createTransaction();
    const { result } = runHook(transactionMeta);

    await act(async () => {
      await result.current.updateTransactionPayAmount(AMOUNT);
    });

    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(commitMock).toHaveBeenCalledWith({
      calls: CALLS,
      requiredAssetAmount: '0x12c4b0',
      transactionId: transactionMeta.id,
    });
  });

  it('rounds the required asset amount down', async () => {
    const transactionMeta = createTransaction();
    const { result } = runHook(transactionMeta);

    await act(async () => {
      await result.current.updateTransactionPayAmount('1.0000005');
    });

    expect(commitMock).toHaveBeenCalledWith(
      expect.objectContaining({ requiredAssetAmount: '0xf4240' }),
    );
  });

  it('leaves the required asset amount unset when decimals are unknown', async () => {
    jest.mocked(useTransactionPayRequiredTokens).mockReturnValue([]);
    const transactionMeta = createTransaction();
    const { result } = runHook(transactionMeta);

    await act(async () => {
      await result.current.updateTransactionPayAmount(AMOUNT);
    });

    expect(commitMock).toHaveBeenCalledWith(
      expect.objectContaining({ requiredAssetAmount: undefined }),
    );
  });

  it('does not commit when there are no calls and the required asset is unchanged', async () => {
    getCallsMock.mockResolvedValue([]);
    const transactionMeta = createTransaction({
      requiredAssets: [
        {
          address: '0x3333333333333333333333333333333333333333',
          amount: '0x12c4b0',
          standard: 'erc20',
        },
      ],
    } as Partial<TransactionMeta>);
    const { result } = runHook(transactionMeta);

    let didCommit = true;
    await act(async () => {
      didCommit = await result.current.updateTransactionPayAmount(AMOUNT);
    });

    expect(didCommit).toBe(false);
    expect(commitMock).not.toHaveBeenCalled();
  });

  it('discards an update superseded by a newer amount', async () => {
    let resolveStale: (calls: typeof CALLS) => void = () => undefined;
    getCallsMock.mockImplementation((_meta, amountHuman) => {
      if (amountHuman === AMOUNT) {
        return new Promise((resolve) => {
          resolveStale = resolve;
        });
      }
      return Promise.resolve(CALLS);
    });
    const transactionMeta = createTransaction();
    const { result } = runHook(transactionMeta);

    let staleResult = true;
    await act(async () => {
      const stale = result.current.updateTransactionPayAmount(AMOUNT);
      await result.current.updateTransactionPayAmount('9.99');
      resolveStale(CALLS);
      staleResult = await stale;
    });

    expect(staleResult).toBe(false);
    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(commitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredAssetAmount: '0x986f70',
      }),
    );
  });

  it('blocks confirm while calldata is encoding', async () => {
    let resolveCalls: (calls: typeof CALLS) => void = () => undefined;
    getCallsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCalls = resolve;
      }),
    );
    const transactionMeta = createTransaction();
    const { result } = runHook(transactionMeta);

    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = result.current.updateTransactionPayAmount(AMOUNT);
    });

    expect(isPayAmountEncodePending(transactionMeta.id)).toBe(true);

    await act(async () => {
      resolveCalls(CALLS);
      await pending;
    });

    expect(isPayAmountEncodePending(transactionMeta.id)).toBe(false);
  });

  it('propagates errors from the external module', async () => {
    getCallsMock.mockReturnValue(Promise.reject(new Error('rpc failure')));
    const { result } = runHook();

    await expect(
      result.current.updateTransactionPayAmount(AMOUNT),
    ).rejects.toThrow('rpc failure');
    expect(commitMock).not.toHaveBeenCalled();
    expect(isPayAmountEncodePending(createTransaction().id)).toBe(false);
  });
});
