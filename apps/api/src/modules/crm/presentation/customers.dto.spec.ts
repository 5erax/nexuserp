import { ValidationPipe } from '@nestjs/common';
import { CreateCustomerInput, UpdateCustomerInput } from './customers.dto';

describe('Customer input boundary', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const branchId = 'f43a9c4c-5015-462b-a3f4-e57904593aa5';
  it('normalizes contacts and permits shared/nullable optional fields', async () => {
    expect(
      await pipe.transform(
        {
          branchId,
          name: '  Khách  ',
          email: '  OWNER@EXAMPLE.TEST ',
          phone: ' 0900 ',
          notes: null,
        },
        { type: 'body', metatype: CreateCustomerInput },
      ),
    ).toMatchObject({ name: 'Khách', email: 'owner@example.test', phone: '0900', notes: null });
    expect(
      await pipe.transform(
        { email: null, phone: null },
        { type: 'body', metatype: UpdateCustomerInput },
      ),
    ).toMatchObject({ email: null, phone: null });
  });
  it.each([
    { name: null },
    { name: '   ' },
    { status: null },
    { branchId },
    { createdBy: branchId },
    { email: 'invalid' },
  ])('rejects malformed or immutable update fields %j', async (body) => {
    await expect(
      pipe.transform(body, { type: 'body', metatype: UpdateCustomerInput }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
