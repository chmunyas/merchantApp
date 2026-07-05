import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, Search, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/auth";
import { getCurrentVenueId } from "@/lib/merchant-dashboard";

export const Route = createFileRoute("/dashboard/knowledge")({
  component: KnowledgePage,
});

type Article = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  embedded: boolean;
};

type Hit = { title: string; body: string; score: number };

function KnowledgePage() {
  const venue = useMemo(() => getCurrentVenueId(), []);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [query, setQuery] = useState("do you have parking?");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await authFetch(`/api/kb?venue=${venue}`);
      const data = (await res.json()) as { articles?: Article[] };
      setArticles(data.articles ?? []);
    } catch {
      setArticles([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue]);

  async function addArticle() {
    if (!title.trim() || !body.trim()) {
      toast.error("Title and body are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch(`/api/kb?venue=${venue}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success("Article saved.");
      setTitle("");
      setBody("");
      setTags("");
      await load();
    } catch {
      toast.error("Could not save (cloud backend offline).");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await authFetch(`/api/kb/${id}?venue=${venue}`, { method: "DELETE" });
      await load();
    } catch {
      toast.error("Could not delete.");
    }
  }

  async function runSearch() {
    setBusy(true);
    setHits(null);
    try {
      const res = await authFetch(`/api/kb/search?venue=${venue}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = (await res.json()) as { hits?: Hit[] };
      setHits(data.hits ?? []);
    } catch {
      setHits([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            Knowledge Base
          </h2>
          <p className="text-sm text-muted-foreground">
            The AI agent answers customer questions from these articles across
            every channel (RAG). Vector search in production, full-text locally.
          </p>
        </div>
        <Badge className="gap-1 bg-violet-100 text-violet-700 hover:bg-violet-100">
          <BookOpen className="h-3.5 w-3.5" /> {articles.length} articles
        </Badge>
      </div>

      <Card className="border-slate-200 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-500" /> Test what the agent
            would answer
          </CardTitle>
          <CardDescription>
            Ask a question the way a customer would.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. is there parking? do you have vegan food?"
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
            />
            <Button type="button" onClick={runSearch} disabled={busy}>
              <Search className="mr-1 h-3.5 w-3.5" /> Search
            </Button>
          </div>
          {hits !== null &&
            (hits.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-muted-foreground">
                No match — the agent would fall back to AI or escalate.
              </p>
            ) : (
              <div className="space-y-2">
                {hits.map((hit, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-900">
                        {hit.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        score {hit.score.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600">{hit.body}</p>
                  </div>
                ))}
              </div>
            ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Add article</CardTitle>
            <CardDescription>Title, answer, and optional tags.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title (e.g. Corkage fee)"
            />
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="The answer the agent should give…"
              rows={4}
            />
            <Input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="tags, comma, separated"
            />
            <div className="flex justify-end">
              <Button type="button" onClick={addArticle} disabled={busy}>
                Save article
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {loading ? (
            <Card className="border-slate-200 bg-white/60">
              <CardContent className="p-6 text-center text-sm text-slate-500">
                Loading…
              </CardContent>
            </Card>
          ) : (
            articles.map((article) => (
              <Card
                key={article.id}
                className="border-slate-200 bg-white/90 shadow-sm"
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-950">
                        {article.title}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {article.body}
                      </p>
                      {article.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {article.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-slate-400 hover:text-red-500"
                      onClick={() => remove(article.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
