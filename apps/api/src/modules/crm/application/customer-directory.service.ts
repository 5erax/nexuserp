import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';

@Injectable()
export class CustomerDirectoryService {
  async lockActive(
    tx: Prisma.TransactionClient,
    organizationId: string,
    branchId: string,
    id: string,
  ) {
    if (typeof Reflect.get(tx, '$connect') === 'function')
      throw new Error('Customer snapshots require a caller transaction');
    const [customer] = await tx.$queryRaw<
      { id: string; name: string; status: string }[]
    >`SELECT id,name,status FROM customers WHERE organization_id = ${organizationId}::uuid AND branch_id = ${branchId}::uuid AND id = ${id}::uuid FOR SHARE`;
    if (!customer) throw new NotFoundException();
    if (customer.status !== 'ACTIVE')
      throw new ConflictException({
        code: 'CUSTOMER_INACTIVE',
        message: 'Khách hàng đã ngừng hoạt động',
      });
    return { id: customer.id, name: customer.name };
  }
  names(tx: Prisma.TransactionClient, organizationId: string, ids: string[]) {
    return tx.customer.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true },
    });
  }
}
