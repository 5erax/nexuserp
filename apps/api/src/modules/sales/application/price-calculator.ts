import { Prisma } from '../../../generated/prisma/client';
import { OrderRuleError } from '../domain/order-rule-error';

export type Discount = { type: 'NONE' | 'AMOUNT' | 'PERCENT'; value: string };
// 18 quantity digits × 20 price digits, plus 100 lines; isolate rounding from global Decimal settings.
const Decimal = Prisma.Decimal.clone({ precision: 50, rounding: Prisma.Decimal.ROUND_HALF_UP });
const money = /^(0|[1-9]\d{0,19})$/;
const quantity = /^(0|[1-9]\d{0,14})(\.\d{1,3})?$/;
const maximum = new Decimal('99999999999999999999');
const invalid = (message: string): never => {
  throw new OrderRuleError('INVALID_ORDER_PRICE', message);
};

export function calculatePrice(
  lines: readonly { quantity: string; unitPrice: string }[],
  discount: Discount = { type: 'NONE', value: '0' },
) {
  if (!lines.length || lines.length > 100) invalid('Đơn phải có từ 1 đến 100 dòng');
  const lineTotals = lines.map((line) => {
    if (!quantity.test(line.quantity) || !money.test(line.unitPrice))
      invalid('Số lượng hoặc đơn giá không hợp lệ');
    const qty = new Decimal(line.quantity);
    if (!qty.gt(0)) invalid('Số lượng phải lớn hơn 0');
    const total = qty.times(line.unitPrice).toDecimalPlaces(0);
    if (total.gt(maximum)) invalid('Thành tiền vượt giới hạn lưu trữ');
    return total;
  });
  const subtotal = lineTotals.reduce((sum, total) => sum.plus(total), new Decimal(0));
  if (subtotal.gt(maximum)) invalid('Tổng tiền vượt giới hạn lưu trữ');
  let discountTotal: InstanceType<typeof Decimal>;
  switch (discount.type) {
    case 'NONE':
      if (discount.value !== '0') invalid('Giảm giá NONE phải bằng 0');
      discountTotal = new Decimal(0);
      break;
    case 'AMOUNT':
      if (!/^(0|[1-9]\d{0,16})$/.test(discount.value))
        invalid('Giảm giá phải là số nguyên đồng trong giới hạn NUMERIC(20,3)');
      discountTotal = new Decimal(discount.value);
      break;
    case 'PERCENT':
      if (
        !/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(discount.value) ||
        new Decimal(discount.value).gt(100)
      )
        invalid('Phần trăm giảm giá phải từ 0 đến 100, tối đa 2 chữ số thập phân');
      discountTotal = subtotal.times(discount.value).div(100).toDecimalPlaces(0);
      break;
    default:
      return invalid('Loại giảm giá không hợp lệ');
  }
  if (discountTotal.gt(subtotal)) invalid('Giảm giá không được vượt tổng tiền hàng');
  return {
    lineTotals: lineTotals.map((total) => total.toFixed(0)),
    subtotal: subtotal.toFixed(0),
    discountTotal: discountTotal.toFixed(0),
    taxTotal: '0',
    grandTotal: subtotal.minus(discountTotal).toFixed(0),
  };
}
