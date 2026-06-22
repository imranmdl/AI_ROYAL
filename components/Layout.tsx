
import React from 'react';
import Sidebar from './Sidebar';
import { UserRole } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  currentRole: UserRole;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  userName: string;
}

const Layout: React.FC<LayoutProps> = ({ children, currentRole, activeTab, setActiveTab, onLogout, userName }) => {
  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gray-50" style={{maxWidth:'100vw',overflowX:'hidden'}}>
      <Sidebar 
        currentRole={currentRole} 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onLogout={onLogout}
        userName={userName}
      />
      {/* min-w-0 is critical: without it, a flex child can exceed parent width causing overflow */}
      <main className="flex-1 min-w-0 p-3 md:p-8 overflow-x-hidden print:p-0 print:overflow-visible">
        <div className="max-w-7xl mx-auto print:max-w-none print:w-full min-w-0">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
