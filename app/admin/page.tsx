import AdminDashboard from "./admin-dashboard";

export const metadata = {
  title: "Eggoria Admin Dashboard",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminDashboard />;
}
