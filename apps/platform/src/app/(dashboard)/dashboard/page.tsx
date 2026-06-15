import { auth } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <main style={{ padding: "2rem" }}>
      <h1>Dashboard</h1>
      <p>Welcome, {session?.user?.name ?? "User"}</p>
      <p>Email: {session?.user?.email}</p>
      <p>Org: {session?.user?.orgId}</p>
    </main>
  );
}
