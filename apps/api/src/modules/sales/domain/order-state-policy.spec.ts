import { OrderStatePolicy, type OrderAction } from './order-state-policy';

describe('OrderStatePolicy', () => {
  const actions: OrderAction[] = [
    'UPDATE',
    'CONFIRM',
    'CANCEL',
    'CREATE_SHIPMENT',
    'POST_SHIPMENT',
    'PAY',
  ];
  const cases = [
    ['DRAFT', ['DRAFT', 'CONFIRMED', 'CANCELLED', null, null, null]],
    ['CONFIRMED', [null, null, 'CANCELLED', 'CONFIRMED', 'FULFILLED', 'CONFIRMED']],
    ['CANCELLED', [null, null, null, null, null, null]],
    ['FULFILLED', [null, null, null, null, null, 'FULFILLED']],
  ] as const;
  for (const [state, results] of cases)
    actions.forEach((action, index) => {
      it(`${state} / ${action}`, () => {
        if (results[index]) expect(OrderStatePolicy.transition(state, action)).toBe(results[index]);
        else
          expect(() => OrderStatePolicy.transition(state, action)).toThrow(
            expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
          );
      });
    });
  it.each(['UPDATE', 'CANCEL'] as const)('prevents %s after receiving money', (action) => {
    expect(() => OrderStatePolicy.transition('DRAFT', action, { hasPayments: true })).toThrow(
      expect.objectContaining({ code: 'ORDER_HAS_PAYMENTS' }),
    );
  });
  it.each(['UPDATE', 'CANCEL'] as const)('prevents %s with posted shipment', (action) => {
    expect(() => OrderStatePolicy.transition('DRAFT', action, { hasPostedShipment: true })).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
    );
  });
  it('prevents editing a draft that already holds stock', () => {
    expect(() => OrderStatePolicy.transition('DRAFT', 'UPDATE', { hasReservations: true })).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
    );
  });
  it('rejects unknown persisted states', () => {
    expect(() => OrderStatePolicy.transition('CLOSED', 'CONFIRM')).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
    );
  });
});
