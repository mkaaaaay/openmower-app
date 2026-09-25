import {clearCalibration, getCalibration, setCalibration, type MowAngleCalibration} from '@/server/mowAngleCalibrationStore';
import {NextRequest, NextResponse} from 'next/server';

export async function GET(request: NextRequest) {
  const mowerId = request.nextUrl.searchParams.get('mowerId');
  if (!mowerId) return NextResponse.json({error: 'mowerId is required'}, {status: 400});
  return NextResponse.json(await getCalibration(mowerId));
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {mowerId?: string; calibration?: MowAngleCalibration};
  if (!body.mowerId || !body.calibration) {
    return NextResponse.json({error: 'mowerId and calibration are required'}, {status: 400});
  }
  await setCalibration(body.mowerId, body.calibration);
  return NextResponse.json({ok: true});
}

export async function DELETE(request: NextRequest) {
  const mowerId = request.nextUrl.searchParams.get('mowerId');
  if (!mowerId) return NextResponse.json({error: 'mowerId is required'}, {status: 400});
  await clearCalibration(mowerId);
  return NextResponse.json({ok: true});
}
