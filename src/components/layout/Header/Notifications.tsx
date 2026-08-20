"use client";

import NotificationBell from "@/components/notifications/NotificationBell";

const Notifications: React.FC = () => {
  return (
    <div className="mx-[8px] md:mx-[10px] lg:mx-[12px] ltr:first:ml-0 ltr:last:mr-0 rtl:first:mr-0 rtl:last:ml-0">
      <NotificationBell />
    </div>
  );
};

export default Notifications;
