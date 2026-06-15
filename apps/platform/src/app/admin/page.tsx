import { auth } from "@/auth";

export default async function AdminPage() {
  const session = await auth();

  return (
    <main style={{ padding: "2rem" }}>
      <h1>Admin</h1>
      <p>Telegram ID: {session?.user?.telegramId}</p>
    </main>
  );
}
