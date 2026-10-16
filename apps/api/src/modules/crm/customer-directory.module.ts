import { Module } from '@nestjs/common';
import { CustomerDirectoryService } from './application/customer-directory.service';

@Module({ providers: [CustomerDirectoryService], exports: [CustomerDirectoryService] })
export class CustomerDirectoryModule {}
