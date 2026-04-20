import { getPublicArticleCalendarEntries } from "@/server/application/public/articles.service";

export async function GET(): Promise<Response> {
    return new Response(
        JSON.stringify(await getPublicArticleCalendarEntries()),
        {
            headers: {
                "Content-Type": "application/json",
            },
        },
    );
}
