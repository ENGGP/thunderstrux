"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

export default function Navbar() {
  const { data: session, status } = useSession();

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "60px",
        background: "white",
        color: "#111",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        borderBottom: "1px solid #ccc",
        boxSizing: "border-box"
      }}
    >
      <Link href="/" style={{ color: "#111", fontWeight: 600, textDecoration: "none" }}>
        Thunderstrux
      </Link>

      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        {session ? (
          <>
            <Link href="/dashboard" style={{ color: "#111" }}>
              Dashboard
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "http://localhost:3000/" })}
              type="button"
            >
              Sign out
            </button>
          </>
        ) : (
          <Link href="/login" style={{ color: "#111" }}>
            Sign in
          </Link>
        )}
      </div>
    </div>
  );
}
