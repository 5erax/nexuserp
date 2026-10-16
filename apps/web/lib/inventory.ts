export const adjustmentStatuses = {
  DRAFT: 'Bản nháp',
  PENDING_APPROVAL: 'Chờ phê duyệt',
  APPROVED: 'Đã phê duyệt',
  POSTED: 'Đã ghi sổ',
  CANCELLED: 'Đã hủy',
  REJECTED: 'Đã từ chối',
} as const;
export const movementTypes = {
  OPENING: 'Tồn đầu kỳ',
  ADJUSTMENT_IN: 'Điều chỉnh tăng',
  ADJUSTMENT_OUT: 'Điều chỉnh giảm',
  SHIPMENT_OUT: 'Xuất giao hàng',
} as const;
