"use client";

/* eslint-disable @next/next/no-img-element -- Google avatars are remote, user-provided URLs */

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type User = {
  publicId: string;
  email: string;
  name: string;
  picture: string;
  position: number;
  referredBy: string | null;
  connectedAt: string;
  lastSeenAt: string;
};

type DashboardData = {
  users: User[];
  total: number;
  guaranteed: number;
  referred: number;
};

const formatDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

export default function AdminDashboard() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(adminToken: string) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin-users", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Dashboard could not be loaded.");
      }
      sessionStorage.setItem("eggoriaAdminToken", adminToken);
      setData(result);
      setToken("");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Dashboard could not be loaded.",
      );
      throw loadError;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const savedToken = sessionStorage.getItem("eggoriaAdminToken");
    if (savedToken) {
      Promise.resolve()
        .then(() => load(savedToken))
        .catch(() => sessionStorage.removeItem("eggoriaAdminToken"));
    }
  }, []);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (data?.users ?? []).filter((user) =>
      [user.name, user.email, user.publicId, user.referredBy].some((value) =>
        String(value || "").toLowerCase().includes(normalizedQuery),
      ),
    );
  }, [data, query]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    load(token.trim()).catch(() => undefined);
  }

  function signOut() {
    sessionStorage.removeItem("eggoriaAdminToken");
    setData(null);
    setQuery("");
  }

  return (
    <main className="admin-shell">
      <header className="header">
        <Link className="brand" href="/">
          <img src="/assets/eggoria/logo-waitlist.png" alt="Eggoria" />
        </Link>
        <div><small>ADMINISTRATION</small><h1>Google Connections</h1></div>
        {data && <button className="ghost" onClick={signOut}>Sign out</button>}
      </header>

      {!data ? (
        <section className="login">
          <i>✦</i><h2>Admin access</h2>
          <p>Enter the dashboard token configured in Vercel.</p>
          <form onSubmit={submit}>
            <label htmlFor="admin-token">Admin token</label>
            <div>
              <input id="admin-token" type="password" autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} required />
              <button disabled={loading}>{loading ? "Loading…" : "Open dashboard"}</button>
            </div>
            <p role="alert">{error}</p>
          </form>
        </section>
      ) : (
        <section>
          <div className="stats">
            <article><span>Total connected</span><strong>{data.total.toLocaleString("en-US")}</strong><small>Verified Google accounts</small></article>
            <article><span>Guaranteed eggs</span><strong>{data.guaranteed.toLocaleString("en-US")}</strong><small>Within the first 5,555</small></article>
            <article><span>Referred users</span><strong>{data.referred.toLocaleString("en-US")}</strong><small>Joined through invite links</small></article>
          </div>
          <section className="users">
            <header>
              <div><small>VERIFIED COMMUNITY</small><h2>Connected Gmail accounts</h2></div>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, Gmail or ID…" aria-label="Search users" />
            </header>
            <div className="table-wrap">
              <table>
                <thead><tr><th>User</th><th>Position</th><th>Referral</th><th>Connected</th><th>Last seen</th></tr></thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.publicId}>
                      <td><div className="person">
                        {user.picture ? <img className="avatar" src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{(user.name || user.email)[0].toUpperCase()}</span>}
                        <div><strong>{user.name}</strong><small>{user.email}</small></div>
                      </div></td>
                      <td><b>#{user.position.toLocaleString("en-US")}</b><small>{user.publicId}</small></td>
                      <td>{user.referredBy || "Direct"}</td>
                      <td>{formatDate(user.connectedAt)}</td>
                      <td>{formatDate(user.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredUsers.length === 0 && <p className="empty">No matching accounts found.</p>}
            </div>
          </section>
        </section>
      )}
    </main>
  );
}
