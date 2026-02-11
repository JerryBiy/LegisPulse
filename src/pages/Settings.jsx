import React, { useState, useEffect } from "react";
import { api as base44 } from "@/api/apiClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Settings as SettingsIcon,
  Bell,
  X,
  Mail,
  Smartphone,
  Save,
  CheckCircle,
} from "lucide-react";

export default function Settings() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formData, setFormData] = useState({
    twitter_notifications_enabled: true,
    phone_notifications_enabled: true,
    email_notifications_enabled: true,
    notification_phone: "",
    notification_preferences: {
      email_updates: true,
      bill_status_changes: true,
      new_bills: true,
    },
  });

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    setIsLoading(true);
    try {
      const userData = await base44.auth.me();
      setFormData({
        twitter_notifications_enabled:
          userData.twitter_notifications_enabled ?? true,
        phone_notifications_enabled:
          userData.phone_notifications_enabled ?? true,
        email_notifications_enabled:
          userData.email_notifications_enabled ?? true,
        notification_phone: userData.notification_phone || "",
        notification_preferences: userData.notification_preferences || {
          email_updates: true,
          bill_status_changes: true,
          new_bills: true,
        },
      });
    } catch (error) {
      console.error("Error loading user data:", error);
    }
    setIsLoading(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await base44.auth.updateMe(formData);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error("Error saving settings:", error);
    }
    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-100 rounded-lg">
            <SettingsIcon className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              Notification Settings
            </h1>
            <p className="text-slate-600 mt-1">
              Manage how you receive updates about tracked bills
            </p>
          </div>
        </div>

        {/* Success Message */}
        {saved && (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-green-800">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">
                  Settings saved successfully!
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Twitter Notifications */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <X className="w-5 h-5 text-blue-500" />
              Twitter/X Feed Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <Label
                  htmlFor="twitter_notifications"
                  className="text-base font-semibold"
                >
                  Enable Twitter Mentions
                </Label>
                <p className="text-sm text-slate-600 mt-1">
                  Get notified when your tracked bills are mentioned on official
                  GA Legislature Twitter accounts
                </p>
              </div>
              <Switch
                id="twitter_notifications"
                checked={formData.twitter_notifications_enabled}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({
                    ...prev,
                    twitter_notifications_enabled: checked,
                  }))
                }
              />
            </div>
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-900 font-medium mb-2">
                Monitored Accounts:
              </p>
              <div className="flex gap-2">
                <Badge variant="outline" className="bg-white">
                  @GeorgiaHouseofReps
                </Badge>
                <Badge variant="outline" className="bg-white">
                  @Georgia_Senate
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Phone Notifications */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-green-500" />
              Phone Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <Label
                  htmlFor="phone_notifications"
                  className="text-base font-semibold"
                >
                  Enable Phone Alerts
                </Label>
                <p className="text-sm text-slate-600 mt-1">
                  Receive SMS or push notifications on your phone for important
                  updates
                </p>
              </div>
              <Switch
                id="phone_notifications"
                checked={formData.phone_notifications_enabled}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({
                    ...prev,
                    phone_notifications_enabled: checked,
                  }))
                }
              />
            </div>

            {formData.phone_notifications_enabled && (
              <div className="space-y-2 pt-4 border-t">
                <Label htmlFor="notification_phone">Phone Number</Label>
                <Input
                  id="notification_phone"
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  value={formData.notification_phone}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      notification_phone: e.target.value,
                    }))
                  }
                />
                <p className="text-xs text-slate-500">
                  We'll send SMS notifications to this number for urgent updates
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Email Notifications */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-purple-500" />
              Email Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <Label
                  htmlFor="email_notifications"
                  className="text-base font-semibold"
                >
                  Enable Email Updates
                </Label>
                <p className="text-sm text-slate-600 mt-1">
                  Receive email notifications for bill updates and alerts
                </p>
              </div>
              <Switch
                id="email_notifications"
                checked={formData.email_notifications_enabled}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({
                    ...prev,
                    email_notifications_enabled: checked,
                  }))
                }
              />
            </div>

            {formData.email_notifications_enabled && (
              <div className="space-y-3 pt-4 border-t">
                <p className="text-sm font-medium text-slate-700">
                  Email Preferences:
                </p>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="email_updates" className="font-normal">
                      Regular email updates
                    </Label>
                    <p className="text-xs text-slate-500">
                      Weekly digest of tracked bills
                    </p>
                  </div>
                  <Switch
                    id="email_updates"
                    checked={formData.notification_preferences.email_updates}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({
                        ...prev,
                        notification_preferences: {
                          ...prev.notification_preferences,
                          email_updates: checked,
                        },
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label
                      htmlFor="bill_status_changes"
                      className="font-normal"
                    >
                      Bill status changes
                    </Label>
                    <p className="text-xs text-slate-500">
                      When a tracked bill changes status
                    </p>
                  </div>
                  <Switch
                    id="bill_status_changes"
                    checked={
                      formData.notification_preferences.bill_status_changes
                    }
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({
                        ...prev,
                        notification_preferences: {
                          ...prev.notification_preferences,
                          bill_status_changes: checked,
                        },
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="new_bills" className="font-normal">
                      New bills matching interests
                    </Label>
                    <p className="text-xs text-slate-500">
                      When new relevant bills are filed
                    </p>
                  </div>
                  <Switch
                    id="new_bills"
                    checked={formData.notification_preferences.new_bills}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({
                        ...prev,
                        notification_preferences: {
                          ...prev.notification_preferences,
                          new_bills: checked,
                        },
                      }))
                    }
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end gap-3">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isSaving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
        </div>

        {/* Info Card */}
        <Card className="border-slate-200 bg-slate-50">
          <CardContent className="p-6">
            <div className="flex gap-3">
              <Bell className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-slate-700 space-y-2">
                <p className="font-medium">About Notifications</p>
                <p>
                  Our notification system keeps you informed about your tracked
                  bills across multiple channels. You can customize exactly what
                  notifications you want to receive and how you want to receive
                  them.
                </p>
                <p className="text-xs text-slate-600 mt-3">
                  Note: Phone notifications require backend functions to be
                  enabled. Contact support to set up SMS/push notification
                  delivery.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
