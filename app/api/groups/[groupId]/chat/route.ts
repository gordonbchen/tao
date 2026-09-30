import { clearStudyChat, getStudyChat, postStudyChat } from "@/lib/study-chat";

type RouteContext = { params: Promise<{ groupId: string }> };

export async function GET(request: Request, { params }: RouteContext) { return getStudyChat("group", (await params).groupId, request); }
export async function POST(request: Request, { params }: RouteContext) { return postStudyChat("group", (await params).groupId, request); }
export async function DELETE(_request: Request, { params }: RouteContext) { return clearStudyChat("group", (await params).groupId); }
