import { AlertCircle, CalendarRange, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getSessionDisplayName,
  getSessionGroupLabel,
  useLegislativeSession,
} from "@/lib/LegislativeSessionContext";
import { cn } from "@/lib/utils";

export default function SessionSelector({
  prominent = false,
  compact = false,
  className,
}) {
  const {
    sessions,
    selectedSession,
    selectedSessionId,
    setSelectedSessionId,
    isLoading,
    error,
  } = useLegislativeSession();

  const groups = sessions.reduce((result, session) => {
    const label = getSessionGroupLabel(session);
    const existing = result.find((group) => group.label === label);
    if (existing) existing.sessions.push(session);
    else result.push({ label, sessions: [session] });
    return result;
  }, []);

  const sessionOptions = groups.map((group) => (
    <SelectGroup key={group.label}>
      <SelectLabel className="text-xs text-slate-500">
        {group.label}
      </SelectLabel>
      {group.sessions.map((session) => (
        <SelectItem key={session.session_id} value={String(session.session_id)}>
          {getSessionDisplayName(session)}
        </SelectItem>
      ))}
    </SelectGroup>
  ));

  if (compact) {
    return (
      <div className={className}>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Session
        </label>
        <Select
          value={selectedSessionId ? String(selectedSessionId) : undefined}
          onValueChange={setSelectedSessionId}
          disabled={isLoading || !sessions.length || Boolean(error)}
        >
          <SelectTrigger
            className="h-9 w-full bg-white text-xs"
            aria-label="Select legislative session"
          >
            {isLoading ? (
              <span className="flex items-center gap-2 text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading
              </span>
            ) : error ? (
              <span className="text-red-700">Sessions unavailable</span>
            ) : (
              <SelectValue placeholder="Select session" />
            )}
          </SelectTrigger>
          <SelectContent>{sessionOptions}</SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div
      className={cn(
        prominent &&
          "rounded-xl border border-blue-200 bg-blue-50/70 p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-blue-100 p-2 text-blue-700">
            <CalendarRange className="h-5 w-5" />
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-900">
              Legislative session
            </label>
            <p className="mt-0.5 text-xs text-slate-600">
              Every bill, note, alert, and tracked record is limited to this
              LegiScan session.
            </p>
          </div>
        </div>

        <div className="w-full sm:w-[330px]">
          {error ? (
            <div className="flex min-h-9 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Unable to load LegiScan sessions
            </div>
          ) : (
            <Select
              value={selectedSessionId ? String(selectedSessionId) : undefined}
              onValueChange={setSelectedSessionId}
              disabled={isLoading || !sessions.length}
            >
              <SelectTrigger
                className={cn(
                  "bg-white",
                  prominent && "h-11 border-blue-300 font-medium",
                )}
                aria-label="Select legislative session"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2 text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions
                  </span>
                ) : (
                  <SelectValue placeholder="Select a session" />
                )}
              </SelectTrigger>
              <SelectContent>
                {sessionOptions}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {prominent && selectedSession && (
        <p className="mt-3 border-t border-blue-200 pt-3 text-sm text-blue-900">
          You’re viewing legislation from:{" "}
          <span className="font-semibold">
            {getSessionDisplayName(selectedSession)}
          </span>
        </p>
      )}
    </div>
  );
}
