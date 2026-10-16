import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { AuditModule } from '../audit/audit.module';
import { SalesModule } from '../sales/sales.module';
import { CustomersService } from './application/customers.service';
import { CustomersController } from './presentation/customers.controller';

@Module({
  imports: [IamModule, AuditModule, SalesModule],
  providers: [CustomersService],
  controllers: [CustomersController],
})
export class CrmModule {}
