import React, { useState, useEffect } from "react";
import { api as base44 } from "@/api/apiClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Twitter,
  ExternalLink,
  Heart,
  Repeat2,
  MessageCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

export default function TwitterFeed({
  trackedBillNumbers = [],
  showAllTweets = false,
}) {
  const [tweets, setTweets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filteredTweets, setFilteredTweets] = useState([]);

  useEffect(() => {
    loadTweets();
  }, []);

  useEffect(() => {
    filterTweets();
  }, [tweets, trackedBillNumbers, showAllTweets]);

  const loadTweets = async () => {
    setIsLoading(true);
    try {
      const tweetsData = await base44.entities.Tweet.list("-posted_at", 50);
      setTweets(tweetsData);
    } catch (error) {
      console.error("Error loading tweets:", error);
    }
    setIsLoading(false);
  };

  const filterTweets = () => {
    if (showAllTweets) {
      setFilteredTweets(tweets);
      return;
    }

    if (trackedBillNumbers.length === 0) {
      setFilteredTweets([]);
      return;
    }

    const filtered = tweets.filter((tweet) =>
      tweet.related_bills?.some((billNum) =>
        trackedBillNumbers.includes(billNum),
      ),
    );
    setFilteredTweets(filtered);
  };

  const getBillBadgeColor = (billNumber) => {
    if (billNumber.startsWith("HB")) {
      return "bg-blue-100 text-blue-800 border-blue-200";
    } else if (billNumber.startsWith("SB")) {
      return "bg-purple-100 text-purple-800 border-purple-200";
    } else if (billNumber.startsWith("HR")) {
      return "bg-indigo-100 text-indigo-800 border-indigo-200";
    }
    return "bg-gray-100 text-gray-800 border-gray-200";
  };

  const getAccountColor = (handle) => {
    if (handle === "@GeorgiaHouseofReps") {
      return {
        bg: "bg-blue-50",
        border: "border-blue-200",
        text: "text-blue-700",
        icon: "text-blue-600",
      };
    }
    return {
      bg: "bg-purple-50",
      border: "border-purple-200",
      text: "text-purple-700",
      icon: "text-purple-600",
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Twitter className="w-5 h-5 text-blue-500" />
          <h3 className="font-semibold text-slate-900">
            {showAllTweets
              ? "Official Legislative Updates"
              : "Tracked Bill Mentions"}
          </h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadTweets}
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {!showAllTweets && trackedBillNumbers.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <h4 className="font-semibold text-slate-900 mb-2">
              No Tracked Bills
            </h4>
            <p className="text-sm text-slate-600">
              Start tracking bills to see Twitter mentions from official GA
              Legislature accounts
            </p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-slate-200 rounded w-3/4 mb-3"></div>
                <div className="h-3 bg-slate-200 rounded w-full mb-2"></div>
                <div className="h-3 bg-slate-200 rounded w-5/6"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredTweets.length > 0 ? (
        <div className="space-y-4">
          <AnimatePresence>
            {filteredTweets.map((tweet) => {
              const colors = getAccountColor(tweet.account_handle);
              return (
                <motion.div
                  key={tweet.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <Card
                    className={`border ${colors.border} ${colors.bg} hover:shadow-md transition-shadow`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-white rounded-full shadow-sm">
                            <Twitter className={`w-4 h-4 ${colors.icon}`} />
                          </div>
                          <div>
                            <h4 className={`font-bold ${colors.text}`}>
                              {tweet.account_name || tweet.account_handle}
                            </h4>
                            <p className="text-sm text-slate-500 font-medium">
                              {tweet.account_handle}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-slate-500">
                          {formatDistanceToNow(new Date(tweet.posted_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-slate-800 leading-relaxed">
                        {tweet.content}
                      </p>

                      {tweet.related_bills &&
                        tweet.related_bills.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {tweet.related_bills.map((billNum, idx) => (
                              <Badge
                                key={idx}
                                variant="outline"
                                className={getBillBadgeColor(billNum)}
                              >
                                {billNum}
                              </Badge>
                            ))}
                          </div>
                        )}

                      {tweet.media_urls && tweet.media_urls.length > 0 && (
                        <div className="grid grid-cols-2 gap-2">
                          {tweet.media_urls.map((url, idx) => (
                            <img
                              key={idx}
                              src={url}
                              alt="Tweet media"
                              className="rounded-lg w-full h-32 object-cover border border-slate-200"
                            />
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                        <div className="flex items-center gap-6 text-sm text-slate-600">
                          {tweet.engagement && (
                            <>
                              <div className="flex items-center gap-1">
                                <MessageCircle className="w-4 h-4" />
                                <span>{tweet.engagement.replies || 0}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Repeat2 className="w-4 h-4" />
                                <span>{tweet.engagement.retweets || 0}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Heart className="w-4 h-4" />
                                <span>{tweet.engagement.likes || 0}</span>
                              </div>
                            </>
                          )}
                        </div>
                        {tweet.tweet_url && (
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            className="text-blue-600 hover:text-blue-700"
                          >
                            <a
                              href={tweet.tweet_url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="w-4 h-4 mr-1" />
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
      ) : !isLoading && showAllTweets ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Twitter className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <h4 className="font-semibold text-slate-900 mb-2">No Tweets Yet</h4>
            <p className="text-sm text-slate-600">
              Official legislative tweets will appear here when available
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
