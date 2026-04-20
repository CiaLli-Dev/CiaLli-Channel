import type { APIContext } from "astro";

import { handleV1 } from "@/server/api/v1";

export async function GET(context: APIContext): Promise<Response> {
    return await handleV1(context);
}

export async function POST(context: APIContext): Promise<Response> {
    return await handleV1(context);
}

export async function PUT(context: APIContext): Promise<Response> {
    return await handleV1(context);
}

export async function PATCH(context: APIContext): Promise<Response> {
    return await handleV1(context);
}

export async function DELETE(context: APIContext): Promise<Response> {
    return await handleV1(context);
}
