import { Prisma } from '../../../generated/prisma/client';
import { calculatePrice, type Discount } from './price-calculator';

describe('VND pricing policy', () => {
  it.each([
    { quantities: ['0.1', '0.2'], price: '10', subtotal: '3' },
    { quantities: ['0.5', '0.5'], price: '1', subtotal: '2' },
    { quantities: ['0.499', '0.001'], price: '1', subtotal: '0' },
    { quantities: ['999999999999999.999'], price: '0', subtotal: '0' },
    { quantities: ['1'], price: '99999999999999999999', subtotal: '99999999999999999999' },
    { quantities: ['1'], price: '9007199254740993', subtotal: '9007199254740993' },
  ])('rounds each exact decimal line: $quantities × $price', ({ quantities, price, subtotal }) => {
    const result = calculatePrice(quantities.map((quantity) => ({ quantity, unitPrice: price })));
    expect(result).toMatchObject({
      subtotal,
      grandTotal: subtotal,
      discountTotal: '0',
      taxTotal: '0',
    });
  });
  it.each([
    { type: 'AMOUNT', value: '1', discount: '1', grand: '49' },
    { type: 'PERCENT', value: '1', discount: '1', grand: '49' },
    { type: 'PERCENT', value: '12.34', discount: '6', grand: '44' },
    { type: 'PERCENT', value: '100', discount: '50', grand: '0' },
    { type: 'NONE', value: '0', discount: '0', grand: '50' },
  ] as const)('applies $type $value', ({ type, value, discount, grand }) => {
    expect(calculatePrice([{ quantity: '1', unitPrice: '50' }], { type, value })).toMatchObject({
      discountTotal: discount,
      grandTotal: grand,
    });
  });
  it('allows zero subtotal with a full percentage discount', () => {
    expect(
      calculatePrice([{ quantity: '1', unitPrice: '0' }], { type: 'PERCENT', value: '100' })
        .grandTotal,
    ).toBe('0');
  });
  it.each([
    { type: 'AMOUNT', value: '51' },
    { type: 'AMOUNT', value: '0.1' },
    { type: 'AMOUNT', value: '100000000000000000' },
    { type: 'PERCENT', value: '100.01' },
    { type: 'PERCENT', value: '1.001' },
    { type: 'NONE', value: '1' },
    { type: 'PERCENT', value: '-1' },
  ] as const)('rejects invalid discount $type $value', (discount) => {
    expect(() => calculatePrice([{ quantity: '1', unitPrice: '50' }], discount)).toThrow();
  });
  it.each(['0', '-1', '0.0001', '1e3', 'NaN', 'Infinity', '1000000000000000', '', ' 1', '01'])(
    'rejects invalid quantity %s',
    (quantity) => {
      expect(() => calculatePrice([{ quantity, unitPrice: '1' }])).toThrow();
    },
  );
  it.each(['-1', '0.1', '1e3', 'NaN', '100000000000000000000'])(
    'rejects invalid VND price %s',
    (unitPrice) => {
      expect(() => calculatePrice([{ quantity: '1', unitPrice }])).toThrow();
    },
  );
  it('rejects empty/oversized orders and overflow before writing Numeric(20,0)', () => {
    expect(() => calculatePrice([])).toThrow();
    expect(() =>
      calculatePrice(Array.from({ length: 101 }, () => ({ quantity: '1', unitPrice: '1' }))),
    ).toThrow();
    expect(() => calculatePrice([{ quantity: '2', unitPrice: '99999999999999999999' }])).toThrow();
    expect(() =>
      calculatePrice(
        Array.from({ length: 2 }, () => ({ quantity: '1', unitPrice: '99999999999999999999' })),
      ),
    ).toThrow();
  });
  it('does not depend on ambient Decimal precision or mutate inputs', () => {
    const lines = Object.freeze([
      Object.freeze({ quantity: '1.001', unitPrice: '99999999999999999' }),
    ]);
    const discount: Discount = Object.freeze({ type: 'PERCENT', value: '12.34' });
    const previous = Prisma.Decimal.precision;
    try {
      Prisma.Decimal.set({ precision: 3 });
      expect(calculatePrice(lines, discount)).toMatchObject({
        lineTotals: ['100099999999999999'],
        subtotal: '100099999999999999',
        discountTotal: '12352340000000000',
        grandTotal: '87747659999999999',
      });
    } finally {
      Prisma.Decimal.set({ precision: previous });
    }
  });
});
