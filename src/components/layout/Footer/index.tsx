"use client";

import React from "react";

const Footer: React.FC = () => {
  return (
    <>
      <div className="grow"></div>

      <footer className="bg-white dark:bg-[#0c1427] rounded-t-md px-[20px] md:px-[25px] py-[15px] md:py-[20px] text-center">
        <p>
          © <span className="text-orange-500">2026 ODDLY</span> — AI-Powered Football Predictions
        </p>
      </footer>
    </>
  );
};

export default Footer;
