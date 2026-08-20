"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ProfileMenu: React.FC = () => {
  const pathname = usePathname();

  const [active, setActive] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleDropdownToggle = () => {
    setActive((prevState) => !prevState);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setActive(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div
      className="relative profile-menu mx-[8px] md:mx-[10px] lg:mx-[12px] ltr:first:ml-0 ltr:last:mr-0 rtl:first:mr-0 rtl:last:ml-0"
      ref={dropdownRef}
    >
      <button
        type="button"
        onClick={handleDropdownToggle}
        className={`flex items-center -mx-[5px] relative ltr:pr-[14px] rtl:pl-[14px] text-black dark:text-white ${
          active ? "active" : ""
        }`}
      >
        <div className="w-[35px] h-[35px] md:w-[42px] md:h-[42px] rounded-full ltr:md:mr-[2px] ltr:lg:mr-[8px] rtl:md:ml-[2px] rtl:lg:ml-[8px] border-[2px] border-primary-200 bg-primary-500 flex items-center justify-center text-white font-semibold text-sm">
          O
        </div>
        <span className="block font-semibold text-[0px] lg:text-base">
          User
        </span>
        <i className="ri-arrow-down-s-line text-[15px] absolute ltr:-right-[3px] rtl:-left-[3px] top-1/2 -translate-y-1/2 mt-px"></i>
      </button>

      {active && (
        <div className="profile-menu-dropdown bg-white dark:bg-[#0c1427] transition-all shadow-3xl dark:shadow-none py-[22px] absolute mt-[13px] md:mt-[14px] w-[195px] z-[1] top-full ltr:right-0 rtl:left-0 rounded-md">
          <div className="flex items-center border-b border-gray-100 dark:border-[#172036] pb-[12px] mx-[20px] mb-[10px]">
            <div className="w-[31px] h-[31px] rounded-full ltr:mr-[9px] rtl:ml-[9px] border-2 border-primary-200 bg-primary-500 flex items-center justify-center text-white font-semibold text-xs">
              O
            </div>
            <div>
              <span className="block text-black dark:text-white font-medium">
                ODDLY User
              </span>
              <span className="block text-xs">Free Plan</span>
            </div>
          </div>

          <ul>
            <li>
              <Link
                href="/settings"
                className={`block relative py-[7px] ltr:pl-[50px] ltr:pr-[20px] rtl:pr-[50px] rtl:pl-[20px] text-black dark:text-white transition-all hover:text-primary-500 ${
                  pathname === "/settings" ? "text-primary-500" : ""
                }`}
              >
                <i className="material-symbols-outlined top-1/2 -translate-y-1/2 !text-[22px] absolute ltr:left-[20px] rtl:right-[20px]">
                  settings
                </i>
                Settings
              </Link>
            </li>
            <li>
              <Link
                href="/performance"
                className={`block relative py-[7px] ltr:pl-[50px] ltr:pr-[20px] rtl:pr-[50px] rtl:pl-[20px] text-black dark:text-white transition-all hover:text-primary-500 ${
                  pathname === "/performance" ? "text-primary-500" : ""
                }`}
              >
                <i className="material-symbols-outlined top-1/2 -translate-y-1/2 !text-[22px] absolute ltr:left-[20px] rtl:right-[20px]">
                  analytics
                </i>
                Performance
              </Link>
            </li>
          </ul>

          <div className="border-t border-gray-100 dark:border-[#172036] mx-[20px] my-[9px]"></div>

          <ul>
            <li>
              <Link
                href="/"
                className="block relative py-[7px] ltr:pl-[50px] ltr:pr-[20px] rtl:pr-[50px] rtl:pl-[20px] text-black dark:text-white transition-all hover:text-primary-500"
              >
                <i className="material-symbols-outlined top-1/2 -translate-y-1/2 !text-[22px] absolute ltr:left-[20px] rtl:right-[20px]">
                  logout
                </i>
                Sign Out
              </Link>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default ProfileMenu;
