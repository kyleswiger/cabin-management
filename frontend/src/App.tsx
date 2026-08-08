import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { getSession, logout } from "./auth";
import { branding } from "./branding";
import { api } from "./api";
import type { Profile } from "./types";
import LoginPage from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import CalendarPage from "./pages/Calendar";
import SuppliesPage from "./pages/Supplies";
import ProjectsPage from "./pages/Projects";
import YardworkPage from "./pages/Yardwork";
import TreksPage from "./pages/Treks";
import AdminPage from "./pages/Admin";
import ProfilePage from "./pages/Profile";

interface AuthState {
  me: Profile;
  isAdmin: boolean;
  refreshMe: () => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

export default function App() {
  const [checked, setChecked] = useState(false);
  const [me, setMe] = useState<Profile | null>(null);

  const loadMe = useCallback(async () => {
    const session = await getSession();
    if (!session) {
      setMe(null);
      setChecked(true);
      return;
    }
    try {
      setMe(await api.get<Profile>("/me"));
    } catch {
      setMe(null);
    }
    setChecked(true);
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  if (!checked) return null;
  if (!me) return <LoginPage onSignedIn={loadMe} />;

  const signOut = () => {
    logout();
    setMe(null);
  };

  return (
    <AuthContext.Provider value={{ me, isAdmin: me.role === "admin", refreshMe: loadMe, signOut }}>
      <nav className="topnav">
        <span className="brand">{branding.emoji} {branding.appName}</span>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/calendar">Calendar</NavLink>
        <NavLink to="/supplies">Supplies</NavLink>
        <NavLink to="/projects">Projects</NavLink>
        <NavLink to="/yardwork">Yardwork</NavLink>
        <NavLink to="/treks">Area guide</NavLink>
        {me.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
        <span className="spacer" />
        <NavLink to="/profile">{me.name.split(" ")[0]}</NavLink>
        <button onClick={signOut}>Sign out</button>
      </nav>
      <main className="page">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/supplies" element={<SuppliesPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/yardwork" element={<YardworkPage />} />
          <Route path="/treks" element={<TreksPage />} />
          <Route path="/admin" element={me.role === "admin" ? <AdminPage /> : <Navigate to="/" />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </AuthContext.Provider>
  );
}
