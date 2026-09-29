import { clearStudyChat, getStudyChat, postStudyChat } from "@/lib/study-chat";

type RouteContext = { params: Promise<{ subjectId: string }> };

export async function GET(_request: Request, { params }: RouteContext) { return getStudyChat("subject", (await params).subjectId); }
export async function POST(request: Request, { params }: RouteContext) { return postStudyChat("subject", (await params).subjectId, request); }
export async function DELETE(_request: Request, { params }: RouteContext) { return clearStudyChat("subject", (await params).subjectId); }
