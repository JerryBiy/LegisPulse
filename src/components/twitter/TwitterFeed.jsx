import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/api/apiClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import XIcon from "@/components/icons/XIcon";
import {
  ExternalLink,
  Heart,
  Repeat2,
  MessageCircle,
  AlertCircle,
  RefreshCw,
  Radio,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

const MOVEMENT_LABELS = {
  introduced: "Introduced",
  assigned_to_committee: "Assigned to Committee",
  committee_hearing: "Committee Hearing",
  passed_committee: "Passed Committee",
  passed_by_substitute: "Passed by Substitute",
  amended: "Amended",
  passed_house: "Passed House",
  passed_senate: "Passed Senate",
  failed: "Failed / Did Not Pass",
  sent_to_governor: "Sent to Governor",
  signed: "Signed",
  vetoed: "Vetoed",
};

export default function XFeed({
  state = "GA",
  sessionId,
  trackedBillNumbers = [],
  showAllPosts = false,
}) {
  const [posts, setPosts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const requestIdRef = useRef(0);

  const loadPosts = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!sessionId) {
      setPosts([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const postsData = await api.entities.XPost.list(
        sessionId,
        "-posted_at",
        50,
        state,
      );
      if (requestId !== requestIdRef.current) return;
      setPosts(postsData);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      console.error("Error loading X posts:", error);
      setPosts([]);
    }
    if (requestId === requestIdRef.current) setIsLoading(false);
  }, [sessionId, state]);

  useEffect(() => {
    setPosts([]);
    loadPosts();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadPosts]);

  const normalizedTrackedBills = useMemo(
    () =>
      new Set(
        trackedBillNumbers.map((number) =>
          String(number || "")
            .toUpperCase()
            .replace(/\s+/g, ""),
        ),
      ),
    [trackedBillNumbers],
  );

  const filteredPosts = useMemo(() => {
    if (showAllPosts) return posts;
    if (normalizedTrackedBills.size === 0) return [];
    return posts.filter((post) =>
      post.related_bills?.some((billNumber) =>
        normalizedTrackedBills.has(
          String(billNumber || "")
            .toUpperCase()
            .replace(/\s+/g, ""),
        ),
      ),
    );
  }, [normalizedTrackedBills, posts, showAllPosts]);

  const getBillBadgeColor = (billNumber) => {
    if (billNumber.startsWith("HB")) {
      return "bg-blue-100 text-blue-800 border-blue-200";
    }
    if (billNumber.startsWith("SB")) {
      return "bg-purple-100 text-purple-800 border-purple-200";
    }
    if (billNumber.startsWith("HR")) {
      return "bg-indigo-100 text-indigo-800 border-indigo-200";
    }
    return "bg-slate-100 text-slate-800 border-slate-200";
  };

  const getAccountColor = (handle) => {
    if (String(handle).toLowerCase().includes("house")) {
      return {
        bg: "bg-blue-50",
        border: "border-blue-200",
        text: "text-blue-700",
        icon: "text-blue-700",
      };
    }
    return {
      bg: "bg-purple-50",
      border: "border-purple-200",
      text: "text-purple-700",
      icon: "text-purple-700",
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <XIcon className="h-5 w-5 text-slate-950" />
          <h3 className="font-semibold text-slate-900">
            {showAllPosts ? "Official Legislative Posts" : "My Bill Alerts"}
          </h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadPosts}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {!showAllPosts && normalizedTrackedBills.size === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <AlertCircle className="mx-auto mb-3 h-12 w-12 text-slate-400" />
            <h4 className="mb-2 font-semibold text-slate-900">
              No Personal or Team Bills
            </h4>
            <p className="text-sm text-slate-600">
              Track a bill personally or add it to a team to receive matching X
              early alerts.
            </p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((item) => (
            <Card key={item} className="animate-pulse">
              <CardContent className="p-6">
                <div className="mb-3 h-4 w-3/4 rounded bg-slate-200" />
                <div className="mb-2 h-3 w-full rounded bg-slate-200" />
                <div className="h-3 w-5/6 rounded bg-slate-200" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredPosts.length > 0 ? (
        <div className="space-y-4">
          <AnimatePresence>
            {filteredPosts.map((post) => {
              const colors = getAccountColor(post.account_handle);
              const movementsByBill = new Map();
              for (const movement of post.movements ?? []) {
                if (!movementsByBill.has(movement.bill_ref)) {
                  movementsByBill.set(movement.bill_ref, []);
                }
                movementsByBill.get(movement.bill_ref).push(movement);
              }
              return (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                >
                  <Card
                    className={`border ${colors.border} ${colors.bg} transition-shadow hover:shadow-md`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="rounded-full bg-white p-2 shadow-sm">
                            <XIcon className={`h-4 w-4 ${colors.icon}`} />
                          </div>
                          <div>
                            <h4 className={`font-bold ${colors.text}`}>
                              {post.account_name || post.account_handle}
                            </h4>
                            <p className="text-sm font-medium text-slate-500">
                              {post.account_handle}
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-slate-500">
                          {formatDistanceToNow(new Date(post.posted_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="whitespace-pre-line leading-relaxed text-slate-800">
                        {post.content}
                      </p>

                      {post.related_bills?.length > 0 && (
                        <div className="space-y-2">
                          {post.related_bills.map((billNumber) => (
                            <div
                              key={billNumber}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <Badge
                                variant="outline"
                                className={getBillBadgeColor(billNumber)}
                              >
                                {billNumber}
                              </Badge>
                              {(movementsByBill.get(billNumber) ?? []).map(
                                (movement) => (
                                  <Badge
                                    key={`${billNumber}:${movement.movement_type}`}
                                    className="border-amber-200 bg-amber-100 text-amber-900"
                                    variant="outline"
                                  >
                                    <Radio className="mr-1 h-3 w-3" />
                                    {MOVEMENT_LABELS[movement.movement_type] ||
                                      movement.movement_type}
                                  </Badge>
                                ),
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {post.media_urls?.length > 0 && (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {post.media_urls.map((url) => (
                            <img
                              key={url}
                              src={url}
                              alt="Media attached to the X post"
                              className="h-36 w-full rounded-lg border border-slate-200 object-cover"
                            />
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                        <div className="flex items-center gap-5 text-sm text-slate-600">
                          <div className="flex items-center gap-1">
                            <MessageCircle className="h-4 w-4" />
                            <span>{post.engagement?.replies || 0}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Repeat2 className="h-4 w-4" />
                            <span>{post.engagement?.reposts || 0}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Heart className="h-4 w-4" />
                            <span>{post.engagement?.likes || 0}</span>
                          </div>
                        </div>
                        {post.x_url && (
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            className="text-slate-700 hover:text-slate-950"
                          >
                            <a
                              href={post.x_url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="mr-1 h-4 w-4" />
                              View on X
                            </a>
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <XIcon className="mx-auto mb-3 h-12 w-12 text-slate-400" />
            <h4 className="mb-2 font-semibold text-slate-900">
              {showAllPosts ? "No X Posts Yet" : "No Matching Bill Alerts Yet"}
            </h4>
            <p className="text-sm text-slate-600">
              {showAllPosts
                ? "Official Georgia legislative posts for this session will appear here."
                : "New official posts about your personal or team bills will appear here."}
            </p>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-xs text-slate-500">
        X detections are early alerts. LegiScan and official legislative records
        remain the source of truth for bill status.
      </p>
    </div>
  );
}
