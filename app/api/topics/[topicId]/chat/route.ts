import { clearStudyChat, getStudyChat, postStudyChat } from "@/lib/study-chat";

type RouteContext = { params: Promise<{ topicId: string }> };

export async function GET(request: Request, { params }: RouteContext) { return getStudyChat("topic", (await params).topicId, request); }
export async function POST(request: Request, { params }: RouteContext) { return postStudyChat("topic", (await params).topicId, request); }
export async function DELETE(_request: Request, { params }: RouteContext) { return clearStudyChat("topic", (await params).topicId); }
