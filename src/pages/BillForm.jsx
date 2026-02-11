// @ts-nocheck
import React, { useState } from "react";
import { api as base44 } from "@/api/apiClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function BillForm() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [billData, setBillData] = useState({
    bill_number: "",
    title: "",
    chamber: "",
    bill_type: "",
    lc_number: "",
    sponsor: "",
    co_sponsors: [],
    session_year: 2026,
    status: "introduced",
    current_committee: "",
    ocga_sections_affected: [],
    pdf_url: "",
    last_action: "",
    last_action_date: "",
    tags: [],
  });

  const handleInputChange = (field, value) => {
    setBillData((prev) => ({ ...prev, [field]: value }));
  };

  const handleArrayAdd = (field, value) => {
    if (value.trim()) {
      setBillData((prev) => ({
        ...prev,
        [field]: [...prev[field], value.trim()],
      }));
    }
  };

  const handleArrayRemove = (field, index) => {
    setBillData((prev) => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await base44.entities.Bill.create(billData);
      navigate(createPageUrl("Dashboard"));
    } catch (error) {
      console.error("Error creating bill:", error);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate(createPageUrl("Dashboard"))}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Add New Bill</h1>
            <p className="text-slate-600">
              Enter the details of a new legislative bill
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="bill_number">Bill Number *</Label>
                  <Input
                    id="bill_number"
                    placeholder="e.g., HB 123, SB 456"
                    value={billData.bill_number}
                    onChange={(e) =>
                      handleInputChange("bill_number", e.target.value)
                    }
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="chamber">Chamber *</Label>
                  <Select
                    value={billData.chamber}
                    onValueChange={(value) =>
                      handleInputChange("chamber", value)
                    }
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select chamber" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="house">House</SelectItem>
                      <SelectItem value="senate">Senate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="bill_type">Bill Type *</Label>
                  <Select
                    value={billData.bill_type}
                    onValueChange={(value) =>
                      handleInputChange("bill_type", value)
                    }
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bill">Bill</SelectItem>
                      <SelectItem value="resolution">Resolution</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="title">Title *</Label>
                <Textarea
                  id="title"
                  placeholder="Enter the full title of the bill"
                  value={billData.title}
                  onChange={(e) => handleInputChange("title", e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="lc_number">LC Number</Label>
                  <Input
                    id="lc_number"
                    placeholder="e.g., LC 28 9876"
                    value={billData.lc_number}
                    onChange={(e) =>
                      handleInputChange("lc_number", e.target.value)
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="sponsor">Primary Sponsor *</Label>
                  <Input
                    id="sponsor"
                    placeholder="e.g., Rep. John Smith"
                    value={billData.sponsor}
                    onChange={(e) =>
                      handleInputChange("sponsor", e.target.value)
                    }
                    required
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Status and Committee */}
          <Card>
            <CardHeader>
              <CardTitle>Status Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="status">Current Status</Label>
                  <Select
                    value={billData.status}
                    onValueChange={(value) =>
                      handleInputChange("status", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="introduced">Introduced</SelectItem>
                      <SelectItem value="in_committee">In Committee</SelectItem>
                      <SelectItem value="passed_first_reading">
                        Passed 1st Reading
                      </SelectItem>
                      <SelectItem value="passed_second_reading">
                        Passed 2nd Reading
                      </SelectItem>
                      <SelectItem value="passed_third_reading">
                        Passed 3rd Reading
                      </SelectItem>
                      <SelectItem value="sent_to_other_chamber">
                        Sent to Other Chamber
                      </SelectItem>
                      <SelectItem value="passed_both_chambers">
                        Passed Both Chambers
                      </SelectItem>
                      <SelectItem value="sent_to_governor">
                        Sent to Governor
                      </SelectItem>
                      <SelectItem value="signed">Signed</SelectItem>
                      <SelectItem value="vetoed">Vetoed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="session_year">Session Year</Label>
                  <Input
                    id="session_year"
                    type="number"
                    value={billData.session_year}
                    onChange={(e) =>
                      handleInputChange(
                        "session_year",
                        parseInt(e.target.value),
                      )
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="pdf_url">PDF URL</Label>
                  <Input
                    id="pdf_url"
                    placeholder="https://..."
                    value={billData.pdf_url}
                    onChange={(e) =>
                      handleInputChange("pdf_url", e.target.value)
                    }
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="current_committee">Current Committee</Label>
                <Input
                  id="current_committee"
                  placeholder="e.g., House Judiciary Committee"
                  value={billData.current_committee}
                  onChange={(e) =>
                    handleInputChange("current_committee", e.target.value)
                  }
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="last_action">Last Action</Label>
                  <Input
                    id="last_action"
                    placeholder="e.g., Referred to committee"
                    value={billData.last_action}
                    onChange={(e) =>
                      handleInputChange("last_action", e.target.value)
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="last_action_date">Last Action Date</Label>
                  <Input
                    id="last_action_date"
                    type="date"
                    value={billData.last_action_date}
                    onChange={(e) =>
                      handleInputChange("last_action_date", e.target.value)
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* OCGA Sections */}
          <Card>
            <CardHeader>
              <CardTitle>OCGA Sections Affected</CardTitle>
            </CardHeader>
            <CardContent>
              <ArrayInput
                values={billData.ocga_sections_affected}
                onAdd={(value) =>
                  handleArrayAdd("ocga_sections_affected", value)
                }
                onRemove={(index) =>
                  handleArrayRemove("ocga_sections_affected", index)
                }
                placeholder="e.g., 16-11-130, 20-2-150"
                label="OCGA Section"
              />
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(createPageUrl("Dashboard"))}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Create Bill
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ArrayInput({ values, onAdd, onRemove, placeholder, label: _label }) {
  const [inputValue, setInputValue] = useState("");

  const handleAdd = () => {
    if (inputValue.trim()) {
      onAdd(inputValue);
      setInputValue("");
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          className="flex-1"
        />
        <Button type="button" onClick={handleAdd} variant="outline">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((value, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-200 rounded-lg"
            >
              <span className="text-sm font-mono">{value}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-slate-400 hover:text-red-500"
                onClick={() => onRemove(index)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
