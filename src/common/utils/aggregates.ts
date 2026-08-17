import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ancestorIdsFromPath } from './naming';

export async function applyStatsDelta(
  prisma: PrismaService,
  params: {
    folderPath: string;
    dataRoomId: string;
    itemDelta: number;
    sizeDelta: bigint;
  },
): Promise<void> {
  const ids = ancestorIdsFromPath(params.folderPath);
  if (ids.length === 0 && params.itemDelta === 0 && params.sizeDelta === 0n) {
    return;
  }

  const operations: Prisma.PrismaPromise<unknown>[] = [];
  if (ids.length > 0) {
    operations.push(
      prisma.folder.updateMany({
        where: { id: { in: ids } },
        data: {
          itemCount: { increment: params.itemDelta },
          totalSize: { increment: params.sizeDelta },
        },
      }),
    );
  }
  operations.push(
    prisma.dataRoom.update({
      where: { id: params.dataRoomId },
      data: {
        itemCount: { increment: params.itemDelta },
        totalSize: { increment: params.sizeDelta },
      },
    }),
  );
  await prisma.$transaction(operations);
}
