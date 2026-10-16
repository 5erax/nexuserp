import { OrderRuleError } from './order-rule-error';

export type OrderAction =
  | 'UPDATE'
  | 'CONFIRM'
  | 'CANCEL'
  | 'CREATE_SHIPMENT'
  | 'POST_SHIPMENT'
  | 'PAY';
type State = 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'FULFILLED';
const transitions: Record<State, Partial<Record<OrderAction, State>>> = {
  DRAFT: { UPDATE: 'DRAFT', CONFIRM: 'CONFIRMED', CANCEL: 'CANCELLED' },
  CONFIRMED: {
    CANCEL: 'CANCELLED',
    CREATE_SHIPMENT: 'CONFIRMED',
    POST_SHIPMENT: 'FULFILLED',
    PAY: 'CONFIRMED',
  },
  CANCELLED: {},
  FULFILLED: { PAY: 'FULFILLED' },
};

export class OrderStatePolicy {
  static transition(
    state: string,
    action: OrderAction,
    facts: { hasPayments?: boolean; hasPostedShipment?: boolean; hasReservations?: boolean } = {},
  ): State {
    const next = Object.hasOwn(transitions, state)
      ? transitions[state as State][action]
      : undefined;
    if (
      !next ||
      ((action === 'UPDATE' || action === 'CANCEL') && facts.hasPostedShipment) ||
      (action === 'UPDATE' && facts.hasReservations)
    )
      throw new OrderRuleError(
        'INVALID_STATE_TRANSITION',
        'Trạng thái đơn không cho phép thao tác này',
      );
    if ((action === 'UPDATE' || action === 'CANCEL') && facts.hasPayments)
      throw new OrderRuleError('ORDER_HAS_PAYMENTS', 'Đơn đã nhận tiền không thể sửa hoặc hủy');
    return next;
  }
}
