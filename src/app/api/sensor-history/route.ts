import {sensorHistoryRecorder} from '@/server/sensorHistoryStore';
import {NextRequest, NextResponse} from 'next/server';

export async function GET(request: NextRequest) {
  await sensorHistoryRecorder.start();
  const mowerId = request.nextUrl.searchParams.get('mowerId') ?? '1';
  return NextResponse.json(sensorHistoryRecorder.getAllMinMax(mowerId));
}
