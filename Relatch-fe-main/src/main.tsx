import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ClerkProvider } from "@clerk/react";
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPubKey) {
  throw new Error("Missing Clerk Publishable Key");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider
  publishableKey={clerkPubKey}
  afterSignOutUrl="/"
      appearance={{
        variables: {
          colorPrimary: "#2563EB",
          colorBackground: "#0B1120",
          colorText: "#F8FAFC",
          colorTextSecondary: "#94A3B8",
          colorInputBackground: "rgba(255,255,255,0.04)",
          colorInputText: "#F8FAFC",
          colorNeutral: "#94A3B8",
          colorDanger: "#ef4444",
          borderRadius: "0.75rem",
          fontFamily: "'Inter', sans-serif",
          fontWeight: {
            normal: 400,
            medium: 500,
            bold: 600,
          },
        },
        elements: {
          rootBox: {
            color: "#F8FAFC",
          },
          card: {
            background: "#0B1120",
            border: "1px solid rgba(255,255,255,0.09)",
            boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
            color: "#F8FAFC",
          },
          headerTitle: {
            color: "#F8FAFC",
            fontFamily: "'Inter', sans-serif",
            fontWeight: "600",
          },
          headerSubtitle: {
            color: "#94A3B8",
          },
          socialButtonsBlockButton: {
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "#F8FAFC",
          },
          socialButtonsBlockButtonText: {
            color: "#F8FAFC",
            fontWeight: "500",
          },
          dividerLine: {
            background: "rgba(255,255,255,0.08)",
          },
          dividerText: {
            color: "#94A3B8",
          },
          formFieldLabel: {
            color: "#94A3B8",
            fontSize: "11px",
          },
          formFieldLabelRow: {
            color: "#94A3B8",
          },
          formFieldInput: {
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "#F8FAFC",
            borderRadius: "0.6rem",
          },
          formFieldInput__focus: {
            border: "1px solid #2563EB",
            boxShadow: "0 0 0 2px rgba(37,99,235,0.15)",
          },
          formFieldHintText: {
            color: "#94A3B8",
          },
          formFieldErrorText: {
            color: "#ef4444",
          },
          formFieldSuccessText: {
            color: "#10b981",
          },
          formFieldAction: {
            color: "#60A5FA",
          },
          formFieldInputShowPasswordButton: {
            color: "#94A3B8",
          },
          formButtonPrimary: {
            background: "#2563EB",
            color: "#F8FAFC",
            fontWeight: "600",
            fontFamily: "'Inter', sans-serif",
            boxShadow: "none",
          },
          formButtonPrimary__hover: {
            background: "#1d4ed8",
          },
          formButtonReset: {
            color: "#94A3B8",
          },
          formHeaderTitle: {
            color: "#F8FAFC",
          },
          formHeaderSubtitle: {
            color: "#94A3B8",
          },
          otpCodeFieldInput: {
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "#F8FAFC",
          },
          otpCodeFieldErrorText: {
            color: "#ef4444",
          },
          formResendCodeLink: {
            color: "#60A5FA",
          },
          alert: {
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            color: "#F8FAFC",
          },
          alertText: {
            color: "#F8FAFC",
          },
          footerAction: {
            display: "none",
          },
          footerActionLink: {
            color: "#60A5FA",
            fontWeight: "500",
          },
          footerActionText: {
            color: "#94A3B8",
          },
          identityPreviewText: {
            color: "#F8FAFC",
          },
          identityPreviewEditButton: {
            color: "#60A5FA",
          },
          verificationLinkStatusText: {
            color: "#F8FAFC",
          },
          verificationLinkStatusIconBox: {
            color: "#60A5FA",
          },
          userPreviewMainIdentifier: {
            color: "#F8FAFC",
          },
          userPreviewSecondaryIdentifier: {
            color: "#94A3B8",
          },
          profileSectionTitleText: {
            color: "#F8FAFC",
          },
          profileSectionPrimaryButton: {
            color: "#60A5FA",
          },
          menuButton: {
            color: "#F8FAFC",
          },
          menuList: {
            background: "#0B1120",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "#F8FAFC",
          },
          menuItem: {
            color: "#F8FAFC",
          },
          footer: {
            background: "#0B1120",
            borderTop: "1px solid rgba(255,255,255,0.07)",
          },
          footerPagesLink: {
            color: "#94A3B8",
          },
          navbar: {
            background: "#0B1120",
            borderRight: "1px solid rgba(255,255,255,0.07)",
            color: "#F8FAFC",
          },
          navbarButtons: {
            color: "#F8FAFC",
          },
          navbarButton: {
            color: "#94A3B8",
          },
          navbarButton__active: {
            color: "#F8FAFC",
            background: "rgba(255,255,255,0.05)",
          },
          navbarButtonText: {
            color: "#F8FAFC",
          },
          navbarButtonIcon: {
            color: "#94A3B8",
          },
          navbarSection: {
            color: "#F8FAFC",
          },
          navbarMobileMenuButton: {
            color: "#F8FAFC",
          },
          scrollBox: {
            background: "#0B1120",
            color: "#F8FAFC",
          },
          pageScrollBox: {
            background: "#0B1120",
            color: "#F8FAFC",
          },
          page: {
            background: "#0B1120",
            color: "#F8FAFC",
          },
          profilePage: {
            background: "#0B1120",
            color: "#F8FAFC",
          },
          profileSection: {
            color: "#F8FAFC",
          },
          profileSectionContent: {
            color: "#F8FAFC",
          },
          profileSectionItem: {
            color: "#F8FAFC",
          },
          accordionTriggerButton: {
            color: "#F8FAFC",
            background: "rgba(255,255,255,0.02)",
          },
          accordionContent: {
            color: "#F8FAFC",
            background: "#0B1120",
          },
          headerBackLink: {
            color: "#60A5FA",
          },
          headerBackIcon: {
            color: "#60A5FA",
          },
          breadcrumbsItem: {
            color: "#94A3B8",
          },
          breadcrumbsItemDivider: {
            color: "#94A3B8",
          },
          breadcrumbsItem__currentPage: {
            color: "#F8FAFC",
          },
          badge: {
            background: "rgba(37,99,235,0.15)",
            color: "#60A5FA",
            border: "1px solid rgba(37,99,235,0.25)",
          },
          tableHead: {
            color: "#94A3B8",
          },
          tagInputContainer: {
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "#F8FAFC",
          },
          selectButton: {
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "#F8FAFC",
          },
          selectButtonIcon: {
            color: "#94A3B8",
          },
          selectOptionsContainer: {
            background: "#0B1120",
            border: "1px solid rgba(255,255,255,0.09)",
          },
          selectOption: {
            color: "#F8FAFC",
          },
          modalBackdrop: {
            background: "rgba(5,10,18,0.75)",
            backdropFilter: "blur(4px)",
          },
          modalContent: {
            background: "#0B1120",
            color: "#F8FAFC",
          },
          userButtonPopoverCard: {
            background: "#0B1120",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "#F8FAFC",
          },
          userButtonPopoverActionButton: {
            color: "#F8FAFC",
          },
          userButtonPopoverActionButtonText: {
            color: "#F8FAFC",
          },
          userButtonPopoverActionButtonIcon: {
            color: "#94A3B8",
          },
          userButtonPopoverFooter: {
            background: "#0B1120",
            borderTop: "1px solid rgba(255,255,255,0.07)",
          },
          userButtonPopoverMain: {
            background: "#0B1120",
            color: "#F8FAFC",
          },
        },
      }}
    >
      <App />
    </ClerkProvider>
  </StrictMode>
);
