import { clearStudyChat, getStudyChat, postStudyChat } from "@/lib/study-chat";

type RouteContext = { params: Promise<{ resourceId: string }> };

export async function GET(request: Request, { params }: RouteContext) { return getStudyChat("resource", (await params).resourceId, request); }
export async function POST(request: Request, { params }: RouteContext) { return postStudyChat("resource", (await params).resourceId, request); }
export async function DELETE(_request: Request, { params }: RouteContext) { return clearStudyChat("resource", (await params).resourceId); }
