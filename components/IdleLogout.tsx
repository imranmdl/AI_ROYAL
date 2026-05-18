
import React, { useEffect, useRef } from 'react';

interface IdleLogoutProps {
  onLogout: () => void;
  timeoutMinutes?: number;
}

const IdleLogout: React.FC<IdleLogoutProps> = ({ onLogout, timeoutMinutes = 30 }) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimer = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      console.log('User idle for too long, logging out...');
      onLogout();
    }, timeoutMinutes * 60 * 1000);
  };

  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    
    const handleActivity = () => resetTimer();

    events.forEach(event => window.addEventListener(event, handleActivity));
    resetTimer();

    return () => {
      events.forEach(event => window.removeEventListener(event, handleActivity));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [onLogout, timeoutMinutes]);

  return null;
};

export default IdleLogout;
