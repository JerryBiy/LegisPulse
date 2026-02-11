import React, { useState, useEffect } from "react";
import { api as base44 } from "@/api/apiClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Mail,
  Plus,
  Users,
  Send,
  Trash2,
  Edit,
  CheckCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function EmailLists() {
  const [emailLists, setEmailLists] = useState([]);
  const [trackedBills, setTrackedBills] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingList, setEditingList] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [sentCount, setSentCount] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [lists, user, bills] = await Promise.all([
        base44.entities.EmailList.list("-created_date"),
        base44.auth.me().catch(() => null),
        base44.entities.Bill.list(),
      ]);

      setEmailLists(lists);
      if (user?.tracked_bill_ids) {
        const filtered = bills.filter((bill) =>
          user.tracked_bill_ids.includes(bill.id),
        );
        setTrackedBills(filtered);
      }
    } catch (error) {
      console.error("Error loading data:", error);
    }
    setIsLoading(false);
  };

  const sendBillUpdate = async (listId) => {
    const emailList = emailLists.find((list) => list.id === listId);
    if (!emailList || trackedBills.length === 0) return;

    setIsSending(true);
    try {
      const billSummary = trackedBills
        .map(
          (bill) =>
            `• ${bill.bill_number}: ${bill.title}\n  Status: ${bill.status.replace(/_/g, " ")}\n  Sponsor: ${bill.sponsor}\n`,
        )
        .join("\n");

      const emailContent = `Dear Client,

Here's your latest update on tracked Georgia legislative bills:

${billSummary}

This is an automated update from your legislative tracking system. Please contact us if you have any questions about these bills or need additional information.

Best regards,
Your Legislative Team`;

      let successCount = 0;
      for (const email of emailList.email_addresses) {
        try {
          await base44.integrations.Core.SendEmail({
            to: email,
            subject: `Legislative Update: ${trackedBills.length} Tracked Bills`,
            body: emailContent,
          });
          successCount++;
        } catch (error) {
          console.error(`Failed to send to ${email}:`, error);
        }
      }

      setSentCount(successCount);
    } catch (error) {
      console.error("Error sending emails:", error);
    }
    setIsSending(false);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Mail className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Email Lists</h1>
              <p className="text-slate-600 mt-1">
                Manage client groups and send bill updates
              </p>
            </div>
          </div>
          <Button
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create List
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium">
                    Email Lists
                  </p>
                  <p className="text-3xl font-bold text-slate-900 mt-1">
                    {emailLists.length}
                  </p>
                </div>
                <Users className="w-8 h-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium">
                    Total Contacts
                  </p>
                  <p className="text-3xl font-bold text-slate-900 mt-1">
                    {emailLists.reduce(
                      (sum, list) => sum + list.email_addresses.length,
                      0,
                    )}
                  </p>
                </div>
                <Mail className="w-8 h-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium">
                    Tracked Bills
                  </p>
                  <p className="text-3xl font-bold text-slate-900 mt-1">
                    {trackedBills.length}
                  </p>
                </div>
                <CheckCircle className="w-8 h-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Email Lists */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {isLoading ? (
            <div className="col-span-full text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-slate-600">Loading email lists...</p>
            </div>
          ) : emailLists.length > 0 ? (
            emailLists.map((list) => (
              <Card key={list.id} className="border border-slate-200">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{list.name}</CardTitle>
                      <p className="text-sm text-slate-500 mt-1">
                        {list.description}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingList(list)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => {
                          await base44.entities.EmailList.delete(list.id);
                          loadData();
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Badge
                      variant="outline"
                      className="flex items-center gap-1"
                    >
                      <Users className="w-3 h-3" />
                      {list.email_addresses.length} contacts
                    </Badge>
                    <Badge
                      variant={list.is_active ? "default" : "secondary"}
                      className={
                        list.is_active ? "bg-green-100 text-green-800" : ""
                      }
                    >
                      {list.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>

                  <Button
                    onClick={() => sendBillUpdate(list.id)}
                    disabled={isSending || trackedBills.length === 0}
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                  >
                    {isSending ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send Bill Update ({trackedBills.length} bills)
                      </>
                    )}
                  </Button>

                  {sentCount > 0 && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                      <p className="text-sm text-emerald-800">
                        ✓ Successfully sent to {sentCount} recipients
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="col-span-full text-center py-12">
              <Mail className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 mb-2">
                No email lists yet
              </h3>
              <p className="text-slate-600 mb-4">
                Create your first email list to start sending bill updates.
              </p>
              <Button
                onClick={() => setShowCreateModal(true)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Your First List
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Modal */}
      <EmailListModal
        isOpen={showCreateModal || !!editingList}
        onClose={() => {
          setShowCreateModal(false);
          setEditingList(null);
        }}
        editingList={editingList}
        onSave={loadData}
      />
    </div>
  );
}

function EmailListModal({ isOpen, onClose, editingList, onSave }) {
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    email_addresses: [],
    is_active: true,
  });
  const [emailInput, setEmailInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editingList) {
      setFormData(editingList);
    } else {
      setFormData({
        name: "",
        description: "",
        email_addresses: [],
        is_active: true,
      });
    }
  }, [editingList]);

  const handleAddEmail = () => {
    if (
      emailInput.trim() &&
      !formData.email_addresses.includes(emailInput.trim())
    ) {
      setFormData((prev) => ({
        ...prev,
        email_addresses: [...prev.email_addresses, emailInput.trim()],
      }));
      setEmailInput("");
    }
  };

  const handleRemoveEmail = (email) => {
    setFormData((prev) => ({
      ...prev,
      email_addresses: prev.email_addresses.filter((e) => e !== email),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (editingList) {
        await base44.entities.EmailList.update(editingList.id, formData);
      } else {
        await base44.entities.EmailList.create(formData);
      }
      onSave();
      onClose();
    } catch (error) {
      console.error("Error saving email list:", error);
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingList ? "Edit Email List" : "Create Email List"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">List Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              required
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              placeholder="Brief description of this email list"
            />
          </div>

          <div>
            <Label>Email Addresses</Label>
            <div className="flex gap-2 mb-2">
              <Input
                placeholder="Enter email address"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && (e.preventDefault(), handleAddEmail())
                }
              />
              <Button type="button" onClick={handleAddEmail} variant="outline">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {formData.email_addresses.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {formData.email_addresses.map((email, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-2 bg-slate-50 rounded"
                  >
                    <span className="text-sm">{email}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveEmail(email)}
                      className="h-6 w-6"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isSubmitting ||
                !formData.name ||
                formData.email_addresses.length === 0
              }
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSubmitting
                ? "Saving..."
                : editingList
                  ? "Update List"
                  : "Create List"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
