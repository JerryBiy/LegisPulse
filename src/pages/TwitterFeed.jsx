import React, { useState, useEffect } from "react";
import { api as base44 } from "@/api/apiClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, AlertCircle, Info, Settings } from "lucide-react";
import TwitterFeed from "../components/twitter/TwitterFeed";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function TwitterFeedPage() {
  const [trackedBills, setTrackedBills] = useState([]);
  const [user, setUser] = useState(null);
  const [showAllTweets, setShowAllTweets] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [userData, bills] = await Promise.all([
        base44.auth.me().catch(() => null),
        base44.entities.Bill.list(),
      ]);

      setUser(userData);
      if (userData?.tracked_bill_ids) {
        const filtered = bills.filter((bill) =>
          userData.tracked_bill_ids.includes(bill.id),
        );
        setTrackedBills(filtered);
      }
    } catch (error) {
      console.error("Error loading data:", error);
    }
  };

  const trackedBillNumbers = trackedBills.map((bill) => bill.bill_number);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <X className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                Legislative Twitter Feed
              </h1>
              <p className="text-slate-600 mt-1">
                Live updates from official Georgia Legislature accounts
              </p>
            </div>
          </div>
          <Link to={createPageUrl("Settings")}>
            <Button variant="outline" className="gap-2">
              <Settings className="w-4 h-4" />
              Notification Settings
            </Button>
          </Link>
        </div>

        {/* Info Banner */}
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="space-y-2 text-sm">
                <p className="text-blue-900 font-medium">
                  Monitoring Official Accounts
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="bg-white">
                    @GeorgiaHouseofReps
                  </Badge>
                  <Badge variant="outline" className="bg-white">
                    @Georgia_Senate
                  </Badge>
                </div>
                <p className="text-blue-800">
                  We monitor these official accounts and alert you when your
                  tracked bills are mentioned.
                  {user?.twitter_notifications_enabled &&
                    user?.phone_notifications_enabled && (
                      <span className="font-medium">
                        {" "}
                        Phone notifications are enabled.
                      </span>
                    )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Implementation Status Notice */}
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="p-4">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div className="space-y-2 text-sm">
                <p className="text-orange-900 font-medium">
                  Twitter Integration Setup Required
                </p>
                <p className="text-orange-800">
                  To enable live Twitter feed and real-time notifications, you
                  need to:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-orange-800 ml-2">
                  <li>Enable backend functions in your app settings</li>
                  <li>
                    Connect Twitter/X API access (we'll guide you through this)
                  </li>
                  <li>Configure phone notification service (SMS/Push)</li>
                </ol>
                <p className="text-orange-800">
                  The interface is ready - once backend functions are enabled,
                  we can set up the live integration.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 font-medium">
                    Tracked Bills
                  </p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">
                    {trackedBills.length}
                  </p>
                </div>
                <Badge className="bg-blue-100 text-blue-800">Monitoring</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 font-medium">
                    Notifications
                  </p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">
                    {user?.twitter_notifications_enabled ? "ON" : "OFF"}
                  </p>
                </div>
                <Badge
                  className={
                    user?.twitter_notifications_enabled
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  }
                >
                  {user?.twitter_notifications_enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 font-medium">
                    Phone Alerts
                  </p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">
                    {user?.phone_notifications_enabled ? "ON" : "OFF"}
                  </p>
                </div>
                <Badge
                  className={
                    user?.phone_notifications_enabled
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  }
                >
                  {user?.phone_notifications_enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Toggle View */}
        <div className="flex gap-2">
          <Button
            variant={!showAllTweets ? "default" : "outline"}
            onClick={() => setShowAllTweets(false)}
            className={!showAllTweets ? "bg-blue-600" : ""}
          >
            My Tracked Bills Only
          </Button>
          <Button
            variant={showAllTweets ? "default" : "outline"}
            onClick={() => setShowAllTweets(true)}
            className={showAllTweets ? "bg-blue-600" : ""}
          >
            All Legislative Tweets
          </Button>
        </div>

        {/* Twitter Feed Component */}
        <TwitterFeed
          trackedBillNumbers={trackedBillNumbers}
          showAllTweets={showAllTweets}
        />

        {/* Help Section */}
        <Card className="border-slate-200">
          <CardContent className="p-6">
            <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-500" />
              How It Works
            </h3>
            <div className="space-y-2 text-sm text-slate-700">
              <p>
                • We monitor official Georgia House and Senate Twitter accounts
                24/7
              </p>
              <p>
                • When a tweet mentions any of your tracked bills, you'll
                receive instant notifications
              </p>
              <p>
                • Notifications can be sent to your phone via SMS or push
                notification
              </p>
              <p>
                • Filter the feed to see only tweets about bills you're tracking
                or view all legislative updates
              </p>
              <p>
                • All tweets are automatically linked to the relevant bill pages
                in your dashboard
              </p>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-200">
              <Link to={createPageUrl("Settings")}>
                <Button variant="outline" className="gap-2">
                  <Settings className="w-4 h-4" />
                  Configure Notification Preferences
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
