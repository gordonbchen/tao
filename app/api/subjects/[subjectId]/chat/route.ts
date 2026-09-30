import { clearStudyChat, getStudyChat, postStudyChat, renameStudyChat } from "@/lib/study-chat";

type RouteContext = { params: Promise<{ subjectId: string }> };

export async function GET(request: Request, { params }: RouteContext) { return getStudyChat("subject", (await params).subjectId, request); }
export async function POST(request: Request, { params }: RouteContext) { return postStudyChat("subject", (await params).subjectId, request); }
export async function DELETE(request: Request, { params }: RouteContext) { return clearStudyChat("subject", (await params).subjectId, request); }
export async function PATCH(request: Request, { params }: RouteContext) { return renameStudyChat("subject", (await params).subjectId, request); }
