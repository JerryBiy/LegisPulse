import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Filter, Search, RefreshCw } from "lucide-react";

export default function BillFilters({ filters, onFilterChange, billCounts }) {
  return (
    <Card className="bg-white border-slate-200">
      <CardContent className="p-6">
        <div className="flex flex-col space-y-4">
          {/* Search and New Bills Button */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Search bills by number, title, or sponsor..."
                value={filters.search || ""}
                onChange={(e) =>
                  onFilterChange({ ...filters, search: e.target.value })
                }
                className="pl-10 border-slate-200 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Filter Controls */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">
                Filters:
              </span>
            </div>

            <Select
              value={filters.chamber || "all"}
              onValueChange={(value) =>
                onFilterChange({
                  ...filters,
                  chamber: value === "all" ? null : value,
                })
              }
            >
              <SelectTrigger className="w-32 border-slate-200">
                <SelectValue placeholder="Chamber" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Chambers</SelectItem>
                <SelectItem value="house">House</SelectItem>
                <SelectItem value="senate">Senate</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.bill_type || "all"}
              onValueChange={(value) =>
                onFilterChange({
                  ...filters,
                  bill_type: value === "all" ? null : value,
                })
              }
            >
              <SelectTrigger className="w-40 border-slate-200">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="bill">Bills</SelectItem>
                <SelectItem value="resolution">Resolutions</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.status || "all"}
              onValueChange={(value) =>
                onFilterChange({
                  ...filters,
                  status: value === "all" ? null : value,
                })
              }
            >
              <SelectTrigger className="w-44 border-slate-200">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
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
                <SelectItem value="dead">Dead</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.session_year?.toString() || "all"}
              onValueChange={(value) =>
                onFilterChange({
                  ...filters,
                  session_year: value === "all" ? null : parseInt(value, 10),
                })
              }
            >
              <SelectTrigger className="w-32 border-slate-200">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                <SelectItem value="2026">2026</SelectItem>
                <SelectItem value="2025">2025</SelectItem>
                <SelectItem value="2024">2024</SelectItem>
                <SelectItem value="2023">2023</SelectItem>
                <SelectItem value="2022">2022</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={() => onFilterChange({})}
              size="sm"
              className="border-slate-200 hover:bg-slate-50"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Clear
            </Button>
          </div>

          {/* Result Summary */}
          <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-slate-100">
            <span className="text-sm text-slate-600">Showing:</span>
            <Badge variant="outline" className="text-slate-700">
              {billCounts?.total || 0} total bills
            </Badge>
            {billCounts?.house > 0 && (
              <Badge variant="outline" className="bg-blue-50 text-blue-700">
                {billCounts.house} House
              </Badge>
            )}
            {billCounts?.senate > 0 && (
              <Badge variant="outline" className="bg-purple-50 text-purple-700">
                {billCounts.senate} Senate
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
