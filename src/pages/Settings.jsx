import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { useToast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Settings as SettingsIcon,
  Bell,
  Mail,
  Smartphone,
  Save,
  UserCircle2,
  Shield,
  KeyRound,
} from "lucide-react";

const TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
];

const DEFAULT_FORM = {
  username: "",
  email: "",
  avatar_url: "",
  phone_number: "",
  job_title: "",
  organization: "",
  timezone: "America/New_York",
  bio: "",
  twitter_notifications_enabled: true,
  phone_notifications_enabled: true,
  email_notifications_enabled: true,
  notification_phone: "",
  notification_preferences: {
    email_updates: true,
    bill_status_changes: true,
    new_bills: true,
  },
};

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isPasswordFormOpen, setIsPasswordFormOpen] = useState(false);
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [cropSource, setCropSource] = useState("");
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState(null);
  const avatarInputRef = useRef(null);

  const clampZoom = (value) => Math.min(3, Math.max(1, value));

  const [formData, setFormData] = useState(DEFAULT_FORM);
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    loadUserData();
  }, []);

  const avatarFallback = useMemo(() => {
    const source = formData.username || formData.email || "U";
    return source.slice(0, 2).toUpperCase();
  }, [formData.username, formData.email]);

  const loadUserData = async () => {
    setIsLoading(true);
    try {
      const userData = await api.auth.me();
      setFormData({
        username: userData.username || userData.name || "",
        email: userData.email || "",
        avatar_url: userData.avatar_url || "",
        phone_number: userData.phone_number || "",
        job_title: userData.job_title || "",
        organization: userData.organization || "",
        timezone: userData.timezone || "America/New_York",
        bio: userData.bio || "",
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
      toast({
        title: "Unable to load account settings",
        description: error.message,
        variant: "destructive",
      });
    }
    setIsLoading(false);
  };

  const handleSaveProfile = async () => {
    const username = formData.username.trim();
    if (username && !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      toast({
        title: "Invalid username",
        description:
          "Use 3-30 characters with letters, numbers, or underscores.",
        variant: "destructive",
      });
      return;
    }

    setIsSavingProfile(true);
    try {
      await api.auth.updateMe({
        ...formData,
        username,
      });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast({
        title: "Account settings saved",
        description: "Your profile and notification preferences were updated.",
      });
    } catch (error) {
      toast({
        title: "Failed to save settings",
        description: error.message,
        variant: "destructive",
      });
    }
    setIsSavingProfile(false);
  };

  const handleAvatarFilePick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file type",
        description: "Please choose an image file.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please upload an image smaller than 5MB.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCropSource(String(reader.result || ""));
      setCropZoom(1);
      setCropOffset({ x: 0, y: 0 });
      setIsCropOpen(true);
    };
    reader.onerror = () => {
      toast({
        title: "Unable to read image",
        description: "Please try another image file.",
        variant: "destructive",
      });
    };
    reader.readAsDataURL(file);
  };

  const handleAvatarClick = () => {
    if (!isUploadingAvatar) {
      avatarInputRef.current?.click();
    }
  };

  const handleCropSave = async () => {
    if (!cropSource) return;

    setIsUploadingAvatar(true);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Image could not be loaded."));
        img.src = cropSource;
      });

      const previewSize = 288;
      const outputSize = 512;
      const baseScale = Math.max(
        previewSize / image.width,
        previewSize / image.height,
      );
      const renderScale = baseScale * cropZoom;
      const drawWidth = image.width * renderScale;
      const drawHeight = image.height * renderScale;
      const drawX = previewSize / 2 - drawWidth / 2 + cropOffset.x;
      const drawY = previewSize / 2 - drawHeight / 2 + cropOffset.y;

      const canvas = document.createElement("canvas");
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Unable to process image.");

      ctx.save();
      ctx.beginPath();
      ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      const scaleFactor = outputSize / previewSize;
      ctx.drawImage(
        image,
        drawX * scaleFactor,
        drawY * scaleFactor,
        drawWidth * scaleFactor,
        drawHeight * scaleFactor,
      );
      ctx.restore();

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error("Failed to generate cropped image."));
          },
          "image/png",
          0.95,
        );
      });

      const croppedFile = new File([blob], `avatar-${Date.now()}.png`, {
        type: "image/png",
      });

      const { publicUrl } = await api.auth.uploadAvatar(croppedFile);
      await api.auth.updateMe({ avatar_url: publicUrl });
      setFormData((prev) => ({ ...prev, avatar_url: publicUrl }));
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setIsCropOpen(false);
      setCropSource("");
      toast({
        title: "Profile picture updated",
        description: "Your new profile image has been uploaded.",
      });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    }
    setIsUploadingAvatar(false);
  };

  const handleChangePassword = async () => {
    if (!passwordData.currentPassword) {
      toast({
        title: "Current password required",
        description: "Enter your current password to verify your identity.",
        variant: "destructive",
      });
      return;
    }
    if (!passwordData.newPassword) {
      toast({
        title: "Password required",
        description: "Enter a new password before saving.",
        variant: "destructive",
      });
      return;
    }
    if (passwordData.newPassword.length < 12) {
      toast({
        title: "Password too weak",
        description: "Use at least 12 characters for your new password.",
        variant: "destructive",
      });
      return;
    }

    const hasLower = /[a-z]/.test(passwordData.newPassword);
    const hasUpper = /[A-Z]/.test(passwordData.newPassword);
    const hasNumber = /\d/.test(passwordData.newPassword);
    const hasSymbol = /[^A-Za-z0-9]/.test(passwordData.newPassword);
    if (!hasLower || !hasUpper || !hasNumber || !hasSymbol) {
      toast({
        title: "Password too weak",
        description:
          "Include uppercase, lowercase, number, and special character.",
        variant: "destructive",
      });
      return;
    }

    if (passwordData.currentPassword === passwordData.newPassword) {
      toast({
        title: "Choose a different password",
        description: "Your new password cannot match your current password.",
        variant: "destructive",
      });
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Confirm password must match the new password.",
        variant: "destructive",
      });
      return;
    }

    setIsSavingPassword(true);
    try {
      await api.auth.updatePassword({
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
      });
      setPasswordData({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setIsPasswordFormOpen(false);
      toast({
        title: "Password updated",
        description: "Your account password was changed successfully.",
      });
    } catch (error) {
      toast({
        title: "Password update failed",
        description: error.message,
        variant: "destructive",
      });
    }
    setIsSavingPassword(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading account settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-100 rounded-lg">
            <SettingsIcon className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              Account Settings
            </h1>
            <p className="text-slate-600 mt-1">
              Manage your profile, security, and notification preferences.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <UserCircle2 className="w-5 h-5 text-blue-600" />
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="flex flex-col md:flex-row gap-6 md:items-center">
              <button
                type="button"
                onClick={handleAvatarClick}
                disabled={isUploadingAvatar}
                className="relative w-32 h-32 rounded-full border border-slate-200 bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center text-2xl font-semibold text-slate-700 hover:ring-2 hover:ring-blue-200 transition-all"
                title="Change profile picture"
              >
                {formData.avatar_url ? (
                  <img
                    src={formData.avatar_url}
                    alt={formData.username || "User"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  avatarFallback
                )}
              </button>

              <input
                ref={avatarInputRef}
                id="avatar_upload"
                type="file"
                accept="image/*"
                onChange={handleAvatarFilePick}
                className="hidden"
              />

              <div className="flex-1 space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder="policy_tracker"
                  value={formData.username}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      username: e.target.value,
                    }))
                  }
                />
                <p className="text-xs text-slate-500">
                  3-30 characters, letters/numbers/underscore.
                </p>
                <p className="text-xs text-slate-500">
                  Click your profile image to upload and crop.
                </p>
              </div>
            </div>

            {isUploadingAvatar && (
              <div className="text-xs text-blue-600">
                Uploading profile picture...
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={formData.email} disabled />
                <p className="text-xs text-slate-500">
                  Email changes are managed through authentication settings.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone_number">Phone Number</Label>
                <Input
                  id="phone_number"
                  placeholder="+1 (555) 555-1234"
                  value={formData.phone_number}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      phone_number: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="organization">Organization</Label>
                <Input
                  id="organization"
                  placeholder="Firm, agency, or client"
                  value={formData.organization}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      organization: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="job_title">Job Title</Label>
                <Input
                  id="job_title"
                  placeholder="Legislative Analyst"
                  value={formData.job_title}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      job_title: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Timezone</Label>
                <Select
                  value={formData.timezone || "America/New_York"}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, timezone: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  placeholder="Add a short bio or role notes"
                  value={formData.bio}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, bio: e.target.value }))
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-emerald-600" />
              Security
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Password</p>
                <p className="text-xs text-slate-500">
                  Re-enter current password and choose a strong replacement.
                </p>
              </div>
              <Button
                onClick={() => setIsPasswordFormOpen((prev) => !prev)}
                variant="outline"
              >
                <KeyRound className="w-4 h-4 mr-2" />
                {isPasswordFormOpen ? "Cancel" : "Change Password"}
              </Button>
            </div>

            {isPasswordFormOpen && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="currentPassword">Current Password</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={passwordData.currentPassword}
                      onChange={(e) =>
                        setPasswordData((prev) => ({
                          ...prev,
                          currentPassword: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      value={passwordData.newPassword}
                      onChange={(e) =>
                        setPasswordData((prev) => ({
                          ...prev,
                          newPassword: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={passwordData.confirmPassword}
                      onChange={(e) =>
                        setPasswordData((prev) => ({
                          ...prev,
                          confirmPassword: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="text-xs text-slate-500 bg-slate-50 border rounded-md p-3">
                  New password requirements: minimum 12 characters, including
                  uppercase, lowercase, number, and symbol.
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={handleChangePassword}
                    disabled={isSavingPassword}
                    variant="outline"
                  >
                    <KeyRound className="w-4 h-4 mr-2" />
                    {isSavingPassword ? "Updating..." : "Update Password"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-orange-500" />
              Notification Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <Label
                  htmlFor="twitter_notifications"
                  className="text-base font-semibold"
                >
                  Twitter/X Mentions
                </Label>
                <p className="text-sm text-slate-600 mt-1">
                  Get alerts for mentions of tracked bills from monitored
                  accounts.
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

            <div className="flex items-center justify-between border-t pt-4">
              <div className="flex-1">
                <Label
                  htmlFor="phone_notifications"
                  className="text-base font-semibold"
                >
                  Phone Alerts
                </Label>
                <p className="text-sm text-slate-600 mt-1">
                  Receive urgent updates by phone.
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
              <div className="space-y-2 pl-1">
                <Label htmlFor="notification_phone">Notification Phone</Label>
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
              </div>
            )}

            <div className="flex items-center justify-between border-t pt-4">
              <div className="flex-1">
                <Label
                  htmlFor="email_notifications"
                  className="text-base font-semibold"
                >
                  Email Updates
                </Label>
                <p className="text-sm text-slate-600 mt-1">
                  Choose which email alerts you receive.
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
              <div className="space-y-3 border rounded-lg p-4 bg-slate-50">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="email_updates" className="font-normal">
                      Regular email digest
                    </Label>
                    <p className="text-xs text-slate-500">
                      Weekly summary of tracked bills
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
                      When a tracked bill moves stages
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
                      New relevant bills
                    </Label>
                    <p className="text-xs text-slate-500">
                      Bills matching your interests and lists
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

            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-900 font-medium mb-2">
                Monitored Accounts:
              </p>
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline" className="bg-white">
                  <Mail className="w-3 h-3 mr-1" /> @GeorgiaHouseofReps
                </Badge>
                <Badge variant="outline" className="bg-white">
                  <Smartphone className="w-3 h-3 mr-1" /> @Georgia_Senate
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            onClick={handleSaveProfile}
            disabled={isSavingProfile}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isSavingProfile ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Account Settings
              </>
            )}
          </Button>
        </div>
      </div>

      <Dialog open={isCropOpen} onOpenChange={setIsCropOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Adjust Profile Picture</DialogTitle>
            <DialogDescription>
              Drag the image and use zoom to choose what appears inside the
              avatar circle.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div
              className="mx-auto w-72 h-72 rounded-full overflow-hidden border border-slate-200 bg-slate-100 touch-none"
              onPointerDown={(e) => {
                setDragState({
                  pointerId: e.pointerId,
                  startX: e.clientX,
                  startY: e.clientY,
                  baseX: cropOffset.x,
                  baseY: cropOffset.y,
                });
              }}
              onPointerMove={(e) => {
                if (!dragState || dragState.pointerId !== e.pointerId) return;
                setCropOffset({
                  x: dragState.baseX + (e.clientX - dragState.startX),
                  y: dragState.baseY + (e.clientY - dragState.startY),
                });
              }}
              onPointerUp={() => setDragState(null)}
              onPointerCancel={() => setDragState(null)}
              onWheel={(e) => {
                e.preventDefault();
                const delta = -e.deltaY * 0.0015;
                setCropZoom((prev) => clampZoom(prev + delta));
              }}
            >
              {cropSource ? (
                <img
                  src={cropSource}
                  alt="Avatar crop preview"
                  draggable={false}
                  className="w-full h-full object-cover pointer-events-none select-none"
                  style={{
                    transform: `translate(${cropOffset.x}px, ${cropOffset.y}px) scale(${cropZoom})`,
                    transformOrigin: "center center",
                  }}
                />
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="avatar_zoom">Zoom</Label>
              <input
                id="avatar_zoom"
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={cropZoom}
                onChange={(e) => setCropZoom(clampZoom(Number(e.target.value)))}
                className="w-full h-2 accent-blue-600"
                style={{ accentColor: "#2563eb" }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCropOpen(false);
                setCropSource("");
                setDragState(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCropSave} disabled={isUploadingAvatar}>
              {isUploadingAvatar ? "Uploading..." : "Save Avatar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
