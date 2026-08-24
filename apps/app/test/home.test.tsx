import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Home } from "../src/routes/index";

describe("Home", () => {
  it("shows one heading and the introduction", () => {
    render(<Home />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("顧客の声を、次の行動へつなげる場所です。")).toBeInTheDocument();
  });
});
