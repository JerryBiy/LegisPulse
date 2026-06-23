import BillForm from "./pages/BillForm";
import Calendar from "./pages/Calendar";
import Committees from "./pages/Committees";
import Comparison from "./pages/Comparison";
import Dashboard from "./pages/Dashboard";
import EmailLists from "./pages/EmailLists";
import MeetingIntelligence from "./pages/MeetingIntelligence";
import Settings from "./pages/Settings";
import Team from "./pages/Team";
import TrackedBills from "./pages/TrackedBills";
import TwitterFeed from "./pages/TwitterFeed";
import __Layout from "./Layout.jsx";

export const PAGES = {
  BillForm: BillForm,
  Calendar: Calendar,
  Committees: Committees,
  Comparison: Comparison,
  Dashboard: Dashboard,
  EmailLists: EmailLists,
  MeetingIntelligence: MeetingIntelligence,
  Settings: Settings,
  Team: Team,
  TrackedBills: TrackedBills,
  TwitterFeed: TwitterFeed,
};

export const pagesConfig = {
  mainPage: "Dashboard",
  Pages: PAGES,
  Layout: __Layout,
};
